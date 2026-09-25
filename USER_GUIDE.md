# @everworker/oneringai - Complete User Guide

**Version:** 1.1.6
**Last Updated:** 2026-09-04

A comprehensive guide to using all features of the @everworker/oneringai library.

---

## Table of Contents

- [Upgrading to 1.1.3](#upgrading-to-113) — refreshed model registries, lifecycle metadata, pricing, and provider defaults
- [Upgrading to 1.1.2](#upgrading-to-112) — context rollover, portable protocol v2, rotating OpenAI credentials, and the runtime baseline
- [Upgrading to 1.1.1](#upgrading-to-111) — portable Agents, Agent-aware Realtime, and WebRTC call metadata
- [Portable Agent Packages](#portable-agent-packages) — trusted-host hydration with local and remote tools
- [Upgrading to 1.0.0](#upgrading-to-100) — runtime requirements, breaking changes, compatibility guarantees, and migration checklist
- [Agent Runtime (preview)](#agent-runtime-preview) — run complete OneRingAI and Codex SDK agents through one observable, capability-gated API
1. [Getting Started](#getting-started)
2. [Core Concepts](#core-concepts)
3. [Basic Text Generation](#basic-text-generation)
   - [Structured Output (JSON)](#structured-output-json) — vendor-agnostic `responseFormat`, native or prompt fallback
4. [Advanced Inference](#advanced-inference) — prompt caching, async batches, provider-hosted tools, telemetry, and data policy
   - [GPT-6 Astra Responses extensions](#gpt-6-astra-responses-extensions) — async tools, steering, configuration updates, and safety monitoring
5. [Connectors & Authentication](#connectors--authentication)
6. [Agent Features](#agent-features)
   - [Instruction Templates](#instruction-templates) — `{{DATE}}`, `{{AGENT_ID}}`, custom `{{COMMAND:arg}}` with extensible registry
   - Multi-User Support (`userId`)
   - Auth Identities (`identities`)
7. [Tools & Function Calling](#tools--function-calling)
    - Built-in, plugin-provided, and connector-generated tools
    - [Connector & Tool Catalog](./docs/CONNECTOR_TOOL_CATALOG.md) — complete 50-template matrix and every specialized pack
    - Developer Tools (Filesystem & Shell — 11 tools)
    - [Custom Tool Generation](#custom-tool-generation) — Agents create, test, and persist their own tools
    - [Document Reader](#document-reader) — PDF, DOCX, XLSX, PPTX, CSV, HTML, images
    - Web Tools (webFetch, web_search via ConnectorTools, web_scrape via ConnectorTools)
    - JSON Tool
    - GitHub Connector Tools (8 tools, including list_branches)
    - [Slack Connector Tools](#slack-connector-tools) — channels, messages, threads, search, mentions, reactions, and users (10 tools)
    - Microsoft Graph Connector Tools (11 tools: email, calendar, meetings, Teams transcripts, OneDrive/SharePoint files)
    - [Google Workspace Connector Tools](#google-workspace-connector-tools) — Gmail, Calendar, Meet, Drive (11 tools)
    - [Zoom Connector Tools](#zoom-connector-tools) — Meeting management and transcripts (3 tools)
    - [Telegram Connector Tools](#telegram-connector-tools) — Bot API tools (send_message, send_photo, get_updates, set_webhook, get_me, get_chat)
    - [Twilio Connector Tools](#twilio-connector-tools) — SMS and WhatsApp (send_sms, send_whatsapp, list_messages, get_message)
    - [Unified Calendar Tool](#unified-calendar-tool) — Cross-provider meeting slot finder (Google + Microsoft)
    - [Multi-Account Connectors](#multi-account-connectors) — Multiple accounts per vendor with automatic routing
8. [Dynamic Tool Management](#dynamic-tool-management)
9. [Session Persistence](#session-persistence)
   - [Centralized Storage Registry](#centralized-storage-registry) — One `configure()` for all backends, multi-tenant `StorageContext`
10. [Context Management](#context-management)
   - Strategy Deep Dive (Algorithmic, Custom)
   - Token Estimation
   - Lifecycle Hooks
11. [Unified Store Tools](#unified-store-tools)
    - Generic CRUD Interface (store_get, store_set, store_delete, store_list, store_action)
    - Available Stores (notes, whiteboard, instructions, user_info, workspace)
    - Custom Store Plugins
12. [Shared Workspace](#shared-workspace)
    - Multi-Agent Coordination
    - Entry Model and Actions
13. [InContextMemory](#incontextmemory-nextgen-plugin)
    - Setup and Configuration
    - Priority-Based Eviction
    - Tools (store_set/store_delete/store_list with store="whiteboard")
    - Host UI metadata (`showInUI`) and host-defined pinning
    - Use Cases and Best Practices
14. [Persistent Instructions](#persistent-instructions-nextgen-plugin)
    - Setup and Configuration
    - Tools (store_set/store_delete/store_list/store_action with store="instructions")
    - Storage and Persistence
    - Use Cases and Best Practices
15. [User Info](#user-info-nextgen-plugin) — ⚠️ deprecated, prefer Self-Learning Memory
    - Setup and Configuration
    - Context Injection (auto-rendered in system message)
    - Tools (store_set/store_get/store_delete/store_action with store="user_info", plus todo_add, todo_update, todo_remove)
    - Storage and Multi-User Isolation
    - Use Cases and Best Practices
16. [Self-Learning Memory](#self-learning-memory-nextgen-plugin) — `MemoryPluginNextGen` + `MemoryWritePluginNextGen` + 12 `memory_*` tools (entities, facts, graph, document search, semantic search, profile auto-regen, three-principal permissions)
    - What it is — entities + facts data model
    - When to use which plugin (working / in-context / memory / memoryWrite / session ingestor)
    - Quick Start (in-process, dev)
    - Storage backends (InMemoryAdapter, MongoMemoryAdapter — raw + Meteor)
    - What gets injected into the system message (rules, user profile, optional org profile)
    - Plugin config (incl. `groupBootstrap`, `personaEntityId`, ACL principals, `recentActivity`, and host visibility policy)
    - The 12 `memory_*` tools (6 read + 6 write incl. `memory_set_agent_rule`)
    - Behavior rules — `memory_set_agent_rule`
    - Background ingestion via `SessionIngestorPluginNextGen`
    - Permissions and scope (three-principal model)
    - Principal-based ACLs (explicit grants, `setAccess`, `scope.principals`, backfill)
    - Security invariants (no ghost-writes, contextId downgrade, numeric clamping)
    - Using the tools without the plugin
    - Direct `MemorySystem` access
17. [Routine Execution](#routine-execution)
    - Overview and Architecture
    - Quick Start
    - RoutineDefinition and Tasks
    - Task Dependencies and Ordering
    - Memory as Inter-Task Bridge
    - Validation and Self-Reflection
    - Retry Logic and Failure Modes
    - Custom Prompts
    - Callbacks and Progress Tracking
    - Complete Example
18. [Async (Non-Blocking) Tools](#async-non-blocking-tools)
    - How It Works (Lifecycle)
    - Auto-Continue vs Manual Mode
    - Configuration (AsyncToolConfig)
    - Events
    - Public API
    - Edge Cases
19. [Long-Running Sessions (Suspend/Resume)](#long-running-sessions-suspendresume)
    - Creating Suspend Tools (SuspendSignal)
    - Running and Detecting Suspension
    - Resuming with Agent.hydrate()
    - Correlation Storage
    - Multi-Step Workflows
20. [MCP (Model Context Protocol)](#mcp-model-context-protocol)
21. [Multimodal (Vision)](#multimodal-vision)
22. [Audio (TTS/STT)](#audio-ttsstt)
23. [Realtime Voice APIs](#openai-realtime-api) — OpenAI and xAI voice agents, live transcription/translation, WebSocket/WebRTC, SIP, and telephony
24. [Image Generation](#image-generation)
25. [Embeddings](#embeddings)
26. [Video Generation](#video-generation)
27. [Custom Media Storage](#custom-media-storage)
    - IMediaStorage Interface
    - Custom S3 Backend Example
    - FileMediaStorage Default
28. [Web Search](#web-search)
29. [Streaming](#streaming)
30. [External API Integration](#external-api-integration)
    - [Complete Connector & Tool Catalog](./docs/CONNECTOR_TOOL_CATALOG.md)
31. [Vendor Templates](#vendor-templates)
    - Quick Setup for 50 Services
    - Authentication Methods
    - Complete Vendor Reference
32. [OAuth for External APIs](#oauth-for-external-apis)
33. [Model Registry](#model-registry)
34. [Scoped Connector Registry](#scoped-connector-registry)
    - Access Control Policies
    - Multi-Tenant Isolation
    - Using with Agent and ConnectorTools
35. [Agent Registry](#agent-registry) — Global tracking, deep inspection, parent/child hierarchy, event fan-in, external control
36. [Agent Orchestrator](#agent-orchestrator) — Multi-agent teams with shared workspace, delegation, and async execution
    - Quick Start
    - Architecture
    - OrchestratorConfig
    - Orchestration Tools (assign_turn, delegate_interactive, send_message, list_agents, destroy_agent)
    - 3-Tier Routing (DIRECT, DELEGATE, ORCHESTRATE)
    - Interactive Delegation (monitoring modes, reclaim conditions)
    - 5-Phase Planning (UNDERSTAND, PLAN, APPROVE, EXECUTE, REPORT)
    - Workspace Delta
    - Agent.inject()
    - Worker Agent Lifecycle
    - Custom System Prompt
    - Per-Type Configuration
37. [Advanced Features](#advanced-features)
38. [Production Deployment](#production-deployment)

---

## Upgrading to 1.1.3

OneRingAI 1.1.3 updates the text, image, video, speech, and embedding model
registries against current vendor documentation. Public APIs remain
source-compatible. Registry-driven model selection now prefers current models
and excludes retired entries, while callable deprecated models retain explicit
deprecation and retirement dates.

Sora 2 and Sora 2 Pro remain callable and are marked deprecated until OpenAI's
Videos API shutdown on September 24, 2026. Applications with explicit Sora
configuration should migrate before that date. See the
[model registry audit](./docs/MODEL_REGISTRY_AUDIT.md) for the complete vendor,
model, lifecycle, and validation record.

## Upgrading to 1.1.2

OneRingAI 1.1.2 is a focused release for long provider sessions and portable
Agent execution across trusted hosts. Normal connector-first Agent and Agent
Runtime applications remain source-compatible, but portable package peers must
move to protocol v2 together and Node.js 22 installations must be at least
22.13.0.

| Change | Who is affected | Required action |
|--------|-----------------|-----------------|
| Explicit semantic rollover | Long-lived Realtime or other provider sessions | End the active execution, then call `agent.rolloverContext()` before creating the replacement provider session |
| Portable protocol v2 | Applications exchanging Agent packages or remote-tool DTOs | Upgrade exporting and receiving runtimes together; do not mix v1 and v2 in one tool-server session |
| Local executable fingerprints | Portable custom tools placed `local` | Share a stable implementation ID and return a `ResolvedLocalTool`; use `createResolvedLocalTool()` for generated built-ins |
| Host-owned portable permissions | Receiving portable-Agent hosts | Derive effective per-tool policy with `toolPermissionResolver`; never trust packaged permission metadata directly |
| Rotating OpenAI credentials | Hosts using short-lived or brokered keys | Use runtime-only `api_key_provider`; keep the callback out of connector persistence |
| Updated runtime baseline | All Node.js 22 consumers | Run Node.js 22.13.0+ or Node.js 24+; non-LTS Node.js 23 is outside the declared engine range |

Rollover is an explicit provider-session operation, not a replacement for the
normal token-triggered compaction performed by `prepare()`. The Agent-level API
uses the configured connector/model for a tool-free continuity summary by
default, preserves eight recent user turns and complete tool pairs, leaves
plugin state and the append-only history journal intact, and checkpoints
configured session storage. Call it only after the old Realtime or external
session has released the Agent's execution lease:

```typescript
await oldRealtimeSession.close();

const result = await agent.rolloverContext({
  preserveRecentTurns: 8,
  reason: 'provider-session-expiring',
});

if (result.performed) {
  console.log({ estimatedNetTokensFreed: result.tokensFreed });
}

const replacementSession = new OpenAIRealtimeAgentSession({ agent });
await replacementSession.connect();
```

If the Agent's configured model cannot make a normal text generation call,
pass a trusted `summarize` callback backed by a text-capable Agent or server
proxy. Standalone contexts expose
`ctx.rollover({ summarize, preserveRecentTurns, reason })` and require the host
to supply that summarizer.

Portable package version 2 treats executable compatibility separately from the
JSON tool definition. Custom local tools must use the same stable
implementation ID on both sides with
`createPortableToolImplementationFingerprint()`. Generated OneRingAI built-ins
carry runtime-aware registry fingerprints and can be returned with
`createResolvedLocalTool(tool)`. Remote definitions carry their own canonical
fingerprint. A matching tool name or schema alone is insufficient.

Packaged `descriptor.permission` data is informational. Hydration applies a
per-tool override only when the trusted receiving host returns one from
`toolPermissionResolver`; the required host-owned Agent permission system still
governs every execution.

For brokered OpenAI credentials, `api_key_provider` resolves and validates a
fresh value for text, image, audio, video, and embedding SDK requests. The
Codex SDK driver resolves it once while opening each Codex session. The auth
form is OpenAI-only and `ConnectorConfigStore` deliberately rejects it because
callbacks and runtime secrets are not serializable.

The dependency refresh moves the direct OpenAI SDK baseline to 7.8, Google Gen
AI to 2.19, MCP to 1.30, and the test runner to Vitest 3.2. Recompile custom
provider wrappers that consume SDK-native types and run their contract tests.

## Upgrading to 1.1.1

OneRingAI 1.1.1 is additive. Existing connector-first Agents, the preview Agent
Runtime, and callers that use `createWebRTCCall()` for an SDP string do not
need to migrate.

Use the new surfaces when an application needs one of these flows:

| Goal | Current surface |
|------|---------------|
| Move one resolved native Agent to a trusted desktop runtime | `exportAgentPackage()` and `hydrateAgentPackage()` |
| Keep selected tools on the source server | `AgentPackageToolServer` and `RemoteToolTransport` |
| Run browser WebRTC media without importing Node dependencies | `@everworker/oneringai/realtime-browser` |
| Bridge renderer Realtime events to a main-process Agent | `OpenAIRealtimeChannelTransport` |
| Obtain the opaque WebRTC call ID for sideband control or cleanup | `createWebRTCCallWithMetadata()` |
| Resolve call-specific identity, context, and permissions | `VoiceBridge({ agentFactory })` |

Portable packages are editable data, not authorization. Keep connector
credentials, source identity, permission policy, provider-native tools,
`vendorOptions`, prompt caching, data-handling policy, and plugin factories in
the trusted receiving host. Node.js 22 remains the minimum runtime.

## Portable Agent Packages

`exportAgentPackage()` captures the serializable state of an already-resolved
native `Agent`: its unrendered instructions, portable runtime limits, context
state, tool definitions and placement, plus optional Realtime metadata. It
never serializes executable functions or connector credentials.

```typescript
import {
  AgentPackageToolServer,
  createPortableToolImplementationFingerprint,
  exportAgentPackage,
  hydrateAgentPackage,
} from '@everworker/oneringai';

const localToolFingerprints = new Map([
  ['read_desktop_file', createPortableToolImplementationFingerprint(
    readDesktopFile.definition,
    'desktop:read_desktop_file:v3',
  )],
]);

// Trusted source server
const packageValue = exportAgentPackage(serverAgent, {
  expiresAt: new Date(Date.now() + 10 * 60_000),
  toolPlacement: (name) => name === 'read_desktop_file' ? 'local' : 'remote',
  toolImplementationFingerprint: (name) => localToolFingerprints.get(name),
  realtime: {
    provider: 'openai',
    connectorName: 'server-openai',
    model: 'gpt-realtime-2.1',
    voice: 'marin',
  },
});
const toolServer = new AgentPackageToolServer(serverAgent, packageValue);

// Trusted desktop main process
const desktopAgent = await hydrateAgentPackage(packageValue, {
  connector: 'desktop-openai',
  model: 'gpt-5.6-terra',
  userId: authenticatedUser.id,
  permissions: desktopPermissionPolicy,
  contextFactory: ({ package: pkg, model, userId, identities }) => ({
    model,
    agentId: pkg.agent.id,
    systemPrompt: pkg.agent.instructions,
    userId,
    identities,
    features: trustedContextFeatures,
    plugins: trustedContextPlugins,
  }),
  localToolResolver: (descriptor) => {
    const tool = resolveAuthorizedDesktopTool(descriptor);
    const implementationFingerprint = localToolFingerprints.get(
      descriptor.definition.function.name,
    );
    return tool && implementationFingerprint
      ? { tool, implementationFingerprint }
      : undefined;
  },
  remoteToolTransport: {
    execute: (request) => authenticatedRpc.executeRemoteTool(request),
  },
  agentConfig: trustedProviderPolicy,
});
```

Custom tools placed `local` must use a stable implementation ID that both
trusted runtimes map through `createPortableToolImplementationFingerprint()`.
The implementation ID is required and must change whenever executable behavior
or one of its dependencies changes.
Hydration requires `localToolResolver` to return a `ResolvedLocalTool`; returning
a bare `ToolFunction` is rejected. Generated OneRingAI built-ins use their
runtime-aware registry fingerprints automatically and can be wrapped with
`createResolvedLocalTool(tool)` on the receiving host. A matching name or JSON
schema alone is never treated as executable compatibility.

Fingerprint inputs follow JSON-wire semantics, so omitted and explicitly
`undefined` optional fields do not diverge after serialization. A tool's
dynamic function description is prompt presentation generated independently on
each host and is excluded from its local executable contract; its callable
schema, blocking mode, and timeout still must match. Remote tool definitions
retain their full canonical definition fingerprint, which package validation
recomputes before hydration or tool-server construction.

The RPC host must authenticate and authorize each request before forwarding it
to `toolServer.execute(request)`. Hydration also rejects a package tool whose
name collides with a trusted context, identity, or host tool; package tools
never overwrite host authority.

Packaged `descriptor.permission` values are informational and are never applied
directly. If a portable tool needs a receiving-host override, provide
`toolPermissionResolver: (descriptor) => trustedPolicyFor(descriptor)` to
`hydrateAgentPackage()`. Returning `undefined` leaves the tool without a
per-tool override; the Agent's required host-owned permission system still
governs execution.

The package and remote-tool protocol require exact JSON objects. A package is
limited to 10,000,000 UTF-8 bytes. Remote arguments and successful results are
limited to 1,000,000 UTF-8 bytes each, and one tool-server session accepts at
most 1,000 distinct request IDs. Unknown fields, non-JSON values, expired or
incompatible packages, cross-package requests, and non-allowlisted tools fail
closed. Exact request retries are idempotent for the bounded server-session
lifetime.

Agent packages and remote-tool DTOs use exact protocol version 2. Version 1
peers reject version 2 objects, and version 2 peers reject version 1 objects.
Deploy the exporting server and receiving host together, or keep the old pair
active until all in-flight version 1 sessions have ended. Do not mix protocol
versions within one tool-server session.

Call `await toolServer.close()` and `desktopAgent.destroy()` when the session
ends. Concurrent close callers share the same shutdown operation, so every
caller waits for in-flight tool execution to settle.

For a voice package, pass `executionProfile: 'realtime'` during hydration.
The package's connector and model remain hints; an authorized
`connectorResolver` may replace both. See
[Distributed Agent Execution](./docs/designs/DISTRIBUTED_AGENT_EXECUTION.md)
for ownership, Electron/WebRTC flow, and security boundaries.

## Upgrading to 1.0.0

OneRingAI 1.0.0 is the first major release and the supported baseline for the
current OpenAI, Anthropic, Google, and xAI APIs. The connector-first application
flow remains the same, but the runtime baseline, registry contract, and the
default Google API path have changed.

### Migration summary

| Change | Who is affected | Required action |
|--------|-----------------|-----------------|
| Node.js 22 minimum | Every application and build pipeline | Upgrade local runtimes, CI, containers, and serverless functions before installing 1.0.0 |
| Registry schema v2 | Code reading model metadata | Handle nullable token limits and use lifecycle/alias helpers as described below |
| Gemini 3.5+ uses Interactions | Google callers that inspect native wire data or provider options | Adopt `steps`/`step.delta`, or temporarily opt out with `vendorOptions.api = 'generateContent'` |
| Current SDK baseline | Custom provider wrappers or code importing SDK-native types | Recompile against OpenAI 7.4, Anthropic 0.116, and Google Gen AI 2.16 |
| Current Realtime contract | Preview Realtime integrations | Move audio settings under `session.audio`, consume current output events, and use the dedicated transcription/translation paths |
| Updated model lifecycle | Routers and model pickers | Stop assuming every `isActive` model is recommended; filter by `lifecycle`, `availability`, and `preferred` |

### 1. Upgrade the runtime and dependencies

OneRingAI now declares `node >= 22.0.0` and builds its primary output for
Node.js 22. Confirm every execution environment before upgrading:

```bash
node --version
npm install @everworker/oneringai@^1.0.0
```

The built-in providers use `openai@7.4`, `@anthropic-ai/sdk@0.116`, and
`@google/genai@2.16`. Applications normally do not need to import those SDKs
directly. If a custom provider or proxy depends on their native types, rebuild
and run its contract tests after the upgrade.

### 2. Migrate registry consumers to schema v2

The stable v1 fields remain available: `name`, `provider`, `isActive`,
`features`, and the original cost fields. Schema v2 adds:

- `lifecycle`, `availability`, and `preferred` for selection policy;
- `aliases` and `snapshots` for floating and pinned identifiers;
- `endpoints` for API routing;
- `deprecationDate`, `retirementDate`, and `replacementModel` for migrations;
- source links and verification dates; and
- long-context, processing-tier, duration, resolution, message, cached-write,
  and multimodal pricing dimensions.

The only narrowing change to existing registry value types is that token limits
are now `number | null`:

```typescript
import {
  MODEL_REGISTRY_SCHEMA_VERSION,
  getModelInfo,
  resolveMaxContextTokens,
} from '@everworker/oneringai';

if (MODEL_REGISTRY_SCHEMA_VERSION !== 2) {
  throw new Error('Unsupported registry schema');
}

const model = getModelInfo('grok-voice-latest');
const publishedLimit = model?.features.input.tokens; // number | null
const operationalLimit = resolveMaxContextTokens(model?.name ?? '', 128_000);
```

Do not coerce `null` to zero. It means the vendor bills or constrains that model
using another dimension and has not published a token window.

### 3. Separate model identity, callability, and recommendation

Lookup helpers resolve aliases without inserting duplicate registry records:

```typescript
import {
  MODEL_REGISTRY,
  getDeprecatedModels,
  getModelInfo,
} from '@everworker/oneringai';

getModelInfo('gpt-5.6')?.name;          // 'gpt-5.6-sol'
getModelInfo('grok-voice-latest')?.name; // 'grok-voice-think-fast-2.0'
MODEL_REGISTRY['gpt-5.6'];              // undefined: direct keys are canonical

const migrationQueue = getDeprecatedModels().map(model => ({
  from: model.name,
  to: model.replacementModel,
  retireAt: model.retirementDate,
}));
```

Use these fields deliberately:

- `isActive`: the provider still accepts requests;
- `lifecycle`: preview, active, legacy, deprecated, or retired;
- `availability`: public, limited, invite-only, enterprise, or region-limited;
- `preferred`: a recommended choice for that vendor/modality; and
- `replacementModel`: the migration target when one is published.

Persist canonical `model.name` values when stable identity matters. Persist an
alias only when following the vendor's moving target is intentional.

### 4. Adopt Google Interactions

`gemini-3.5-*` through `gemini-3.8-*` use the Google Interactions API by default.
Normal `Agent.run()`, `runDirect()`, and streaming callers receive the same
OneRingAI response types; only callers depending on native Google wire details
need immediate changes.

```typescript
const agent = Agent.create({
  connector: 'google',
  model: 'gemini-3.8-flash',
});

// Default: stored Interactions API (`steps` responses and `step.delta` streams).
const first = await agent.runDirect('Remember the code word: aurora');

// Continue the provider-stored interaction without resending its history.
await agent.runDirect('What was the code word?', {
  previousResponseId: first.id,
});

// Temporary compatibility path while migrating native integrations.
await agent.runDirect('Summarize this document', {
  vendorOptions: { api: 'generateContent' },
});
```

Interactions supports tools, reasoning, structured output, usage conversion,
streaming, and `previous_interaction_id` continuity through the normalized
`previousResponseId` option. Interactions are stored by default because Google
requires storage for this continuity flow; set `vendorOptions.store: false`
only when the interaction will not be continued. Prefer the default path for
new code; the opt-out is a migration bridge, not the recommended steady state.
Named `toolChoice` values are translated to Interactions
`generation_config.tool_choice.allowed_tools`. The temporary `generateContent`
path emits `functionCallingConfig.mode = 'ANY'` together with
`allowedFunctionNames`. Forcing one function therefore remains enforced on
both Google API paths rather than degrading to automatic selection.
Streaming conversion also consumes `interaction.status_update`, terminal
`interaction.completed`, and SSE `error` events. Cancellation and failures map
to `failed`, token-budget exhaustion maps to `incomplete`, and a stream that
ends without a terminal event is never reported as successful.

### 5. Migrate Realtime integrations

For OpenAI, use `gpt-realtime-2.1` (or the mini variant), nest formats and VAD
under `session.audio.input/output`, and consume `response.output_audio.*`,
`response.output_text.*`, and `response.output_audio_transcript.*` events.
Transcription connects with `intent=transcription`; continuous translation uses
`/v1/realtime/translations` and its `session.*` event namespace.

For xAI, create a normal `Vendor.Grok` connector and use
`GrokRealtimeSession`. It shares the transport implementation but exposes
xAI's provider-specific session type and full PCM rate set. Use
`GrokRealtimeAPI` for ephemeral browser credentials and SIP refer/hangup.

The complete protocols, events, and production checklists are documented in
[OpenAI Realtime API](#openai-realtime-api) and
[xAI Realtime Voice Agent API](#xai-realtime-voice-agent-api).

### 6. Review model defaults and media behavior

Recommended starting points in 1.0.0 are:

| Workload | Recommended model/API |
|----------|-----------------------|
| Highest-capability OpenAI text/agents | `gpt-6-astra` |
| Balanced OpenAI production agents | `gpt-5.6-terra` |
| Economical OpenAI high-throughput work | `gpt-5.6-luna` |
| Anthropic frontier work | `claude-opus-5`; use `claude-fable-5-1` for the hardest long-horizon work and `claude-sonnet-5` for a faster path |
| Google multimodal/agent work | `gemini-3.8-flash` through Interactions |
| xAI text/agent work | `grok-4.6` |
| OpenAI image generation/editing | `gpt-image-2` |
| Google native image | `gemini-3.1-flash-image` |
| xAI image quality | `grok-imagine-image-2.0` |
| Google multimodal embeddings | `gemini-embedding-2` |
| Google low-cost video | `veo-3.1-lite-generate-preview` |
| xAI higher-fidelity image-to-video | `grok-imagine-video-1.5` |
| OpenAI realtime voice | `gpt-realtime-2.1` |
| xAI realtime voice | `grok-voice-latest` |
| File transcription | `gpt-transcribe`, `gemini-3.5-transcribe`, or `xai-stt` |

Sora 2 and Sora 2 Pro were deprecated with the Videos API on 2026-03-24 but
remain callable until 2026-09-24. OpenAI published no replacement. Surface the
warning and shutdown date while `isActive` remains true.

### 7. Verify the upgrade

At minimum, run:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

For applications with credentials, add a small authenticated smoke test for
each enabled vendor and every production-critical Realtime/media flow. The
library's 1.0.0 validation included 6,381 unit tests across 284 files and 21 live
API checks covering current text models, Google stored Interactions, strict
named-tool selection on both API paths, native images, bounded external-media
embeddings, Omni video, OpenAI Realtime protocols, and xAI TTS/STT/Voice Agent
flows including 32 kHz PCM.

For the complete vendor-by-vendor before/after analysis, see
[`docs/MODEL_REGISTRY_AUDIT.md`](./docs/MODEL_REGISTRY_AUDIT.md).

---

## Getting Started

### Installation

```bash
npm install @everworker/oneringai
```

### Environment Setup

Create a `.env` file in your project root:

```env
# AI Provider Keys
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
GROQ_API_KEY=...
XAI_API_KEY=xai-...

# Optional: OAuth encryption key for external APIs
OAUTH_ENCRYPTION_KEY=your-32-byte-hex-key
```

### First Agent

```typescript
import { Connector, Agent, Vendor } from '@everworker/oneringai';

// 1. Create a connector (authentication)
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// 2. Create an agent
const legacyAgent = Agent.create({
  connector: 'openai',
  model: 'gpt-5.6-terra',
});

// 3. Run the agent
const response = await agent.run('What is the capital of France?');
console.log(response.output_text);
// Output: "The capital of France is Paris."
```

---

## Core Concepts

### Connector-First Architecture

The library uses a **Connector-First Architecture** where **Connectors** are the single source of truth for authentication.

```
User Code → Connector Registry → Agent → Provider → LLM
```

**Key Benefits:**
- **One auth system** for both AI providers AND external APIs
- **Multiple keys per vendor** (e.g., `openai-main`, `openai-backup`)
- **Named connectors** for easy reference
- **No API key management in agent code**

### The Three Core Classes

1. **Connector** - Manages authentication
2. **Agent** - Orchestrates LLM interactions
3. **Vendor** - Const object of supported AI providers (e.g., `Vendor.OpenAI`, `Vendor.Anthropic`)

---

## Basic Text Generation

### Simple Question/Answer

```typescript
import { Connector, Agent, Vendor } from '@everworker/oneringai';

// Setup
Connector.create({
  name: 'anthropic',
  vendor: Vendor.Anthropic,
  auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY! },
});

const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-fable-5-1',
});

// Ask a question
const response = await agent.run('Explain quantum computing in simple terms.');
console.log(response.output_text);
```

### Multi-Turn Conversations

Agents maintain conversation history automatically:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-5.6-terra',
});

// First turn
await agent.run('My favorite color is blue.');

// Second turn (agent remembers)
const response = await agent.run('What is my favorite color?');
console.log(response.output_text);
// Output: "Your favorite color is blue."
```

### Configuration Options

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',

  // Optional settings
  temperature: 0.7,          // Randomness (0.0 - 1.0)
  maxIterations: 50,         // Max tool calling rounds (default: 50)

  instructions: `You are a helpful assistant.
                 Always be concise and professional.`,
});
```

### Runtime Configuration

Change settings during execution:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-5.6-terra',
});

// Change to a model that supports sampling controls.
agent.setModel('gpt-4.1');

// Change temperature
agent.setTemperature(0.9);

// Get current settings
console.log(agent.getTemperature()); // 0.9
```

### Structured Output (JSON)

Request JSON output with one vendor-agnostic option, `responseFormat`. The library translates it to each vendor's **native** structured-output mechanism where the model supports it — OpenAI (`text.format`), current supported Anthropic models (`output_config.format`), and Google/Vertex (`responseJsonSchema`) — and falls back to a strict prompt instruction otherwise. It then parses (and, on parse failure, re-asks once for) the output and attaches the result to `response.output_parsed`. The raw JSON string is still available on `response.output_text`.

> **Validation contract:** on the *native* path the vendor enforces its supported schema subset server-side. Provider adapters may move unsupported constraints into descriptions so the native request remains portable; Anthropic uses its official SDK transformer for this normalization. On the *prompt-fallback* path the library guarantees **valid, parseable JSON** but does **not** itself validate schema conformance. Validate `output_parsed` against the original schema when you need every constraint enforced. (This is a deliberate choice to avoid a JSON-schema-validator dependency.)

Two modes:

- **`{ type: 'json_object' }`** — any valid JSON value.
- **`{ type: 'json_schema', schema, name?, description?, strict? }`** — JSON constrained to a JSON Schema.

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });

// Schema-constrained
const res = await agent.run('Extract: Jane Doe, jane@acme.com, Enterprise plan', {
  responseFormat: {
    type: 'json_schema',
    name: 'contact',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        plan: { type: 'string' },
      },
      required: ['name', 'email'],
      additionalProperties: false,
    },
  },
});
console.log(res.output_parsed); // { name: 'Jane Doe', email: 'jane@acme.com', plan: 'Enterprise' }

// Any-JSON mode
const summary = await agent.run('Summarize this note as JSON with `title` and `tags`', {
  responseFormat: { type: 'json_object' },
});

// Single-shot, no context management
const direct = await agent.runDirect('Return 3 primary colors as a JSON array of strings', {
  responseFormat: { type: 'json_object' },
});
console.log(direct.output_parsed); // ['red', 'green', 'blue']
```

**The API is identical across vendors** — swap the connector (`anthropic`, `google`, `grok`, …) and the same `responseFormat` works; the library selects the native mechanism or prompt fallback per model.

**Behavior & limits:**

| Aspect | Behavior |
|--------|----------|
| Scope | JSON only (`json_object`, `json_schema`) |
| Schema validation | Native path: the provider-supported subset is enforced server-side; adapters may move unsupported constraints into descriptions. Prompt-fallback path: **parseability only**. Validate `output_parsed` against the original schema when every constraint matters |
| `run()` tool loops | Constrains the **final** answer. OpenAI composes natively and Google composition is model-specific. Anthropic conservatively uses a final tool-free pass whenever tools are present because citation-producing server tools conflict with JSON outputs |
| Streaming | `stream()` / `streamDirect()` stream raw text and don't attach `output_parsed` (parse the accumulated text yourself). Enforced only where it applies inline (native, or prompt fallback with no tools); `stream()` has no final reformat pass, so **with tools on a prompt-fallback vendor the output isn't guaranteed to be JSON** (a warning is logged) — use `run()` for that case |
| Parse failure | After **one** tool-free re-ask, throws `StructuredOutputError` (carrying raw output + schema) and logs it — never a silent failure |
| Where to set it | `RunOptions.responseFormat` (`run`/`stream`) and `DirectCallOptions.responseFormat` (`runDirect`/`streamDirect`); the `ResponseFormat` type is exported from the package root |

> **Per-vendor:** OpenAI, current supported Anthropic families, and Google/Vertex use native schema output when the concrete model supports it. Older or unknown Claude models use the prompt fallback; Anthropic `json_object` also remains prompt-based because its native contract is schema-based. Tool composition is model-specific—when it is unavailable, `run()` performs the final tool-free pass described above. Non-streaming formatted responses report `structured_output_enforcement` as `native`, `prompt`, or `repair`.

---

## Advanced Inference

Advanced inference is the provider-neutral layer for capabilities that go beyond a basic interactive
text request:

- prompt/context caching;
- asynchronous provider batch jobs;
- tools executed by the model provider;
- detailed cache, reasoning, tool, tier, and processing-mode telemetry;
- explicit host authorization for retention-sensitive or third-party features.

The API is normalized, but support is not assumed to be uniform. Every request is checked against
the concrete provider and model before provider inference. Unknown model families fail closed for
provider-hosted tools and asynchronous batches.

### Four API surfaces

Advanced options appear on four related surfaces. Agent-facing calls use camelCase; the low-level
provider/batch contract uses snake_case.

| Surface | Configuration | Behavior |
|---------|---------------|----------|
| `Agent.create()` | `promptCache`, `nativeTools`, `dataHandling` | Defaults for context-managed `run()` / `stream()` calls |
| `agent.run()` / `agent.stream()` | Same camelCase fields in `RunOptions` | Per-call replacement of the agent defaults; participates in context and the agentic loop |
| `agent.runDirect()` / `agent.streamDirect()` | Same camelCase fields in `DirectCallOptions` | Stateless single provider call; pass advanced options explicitly, and handle any native tool output yourself |
| `agent.getBatchProvider()` | `TextGenerateOptions`: `prompt_cache`, `native_tools`, `data_handling`, `response_format` | Durable provider batch submission; the host owns job persistence and polling |

`RunOptions` take precedence over agent-level values. `vendorOptions` are shallow-merged; advanced
objects and arrays are replaced as whole values. Pass `nativeTools: []` or
`promptCache: { mode: 'off' }` to suppress an agent-level request for one context-managed call.
Direct calls intentionally use only `DirectCallOptions` for per-call inference settings; they do not
inherit the agent's instructions, temperature, or advanced request defaults.

```typescript
const agent = Agent.create({
  connector: 'openai-main',
  model: 'gpt-5.4',
  promptCache: { mode: 'auto', key: 'assistant-v4' },
  dataHandling: { allowProviderCaching: true },
});

// Uses the agent defaults.
await agent.run('Analyze the attached policy');

// Replaces the cache policy for this call.
await agent.run('Handle a sensitive one-off request', {
  promptCache: { mode: 'off' },
});
```

### Capability discovery

Always discover executable behavior from the agent/provider pair before enabling a feature in a UI
or workflow:

```typescript
const capabilities = agent.getAdvancedCapabilities();

if (capabilities.promptCaching.mode !== 'unsupported') {
  console.log('TTL choices:', capabilities.promptCaching.ttlModes);
}

if (capabilities.nativeTools.includes('file_search')) {
  // Show vector-store selection in the UI.
}

const batch = agent.getBatchProvider();
if (capabilities.batch.supported && batch) {
  console.log('Maximum requests:', capabilities.batch.maxRequests);
  console.log('Completion window:', capabilities.batch.completionWindow);
}
```

The returned contract is:

```typescript
interface AdvancedTextCapabilities {
  promptCaching: {
    mode: 'unsupported' | 'implicit' | 'request_controlled' | 'explicit_resource';
    ttlModes: Array<'short' | 'extended'>;
    reportsCacheUsage: boolean;
    explicitBreakpoints?: boolean;
  };
  batch: {
    supported: boolean;
    cancellable: boolean;
    maxRequests?: number;
    completionWindow?: string;
  };
  structuredOutput: {
    jsonObject: 'native' | 'prompt';
    jsonSchema: 'native' | 'prompt';
    nativeWithTools: boolean;
  };
  nativeTools: Array<
    'web_search' | 'web_fetch' | 'code_execution' | 'file_search' | 'remote_mcp'
  >;
  nativeToolOptions: { remoteMcpApproval: boolean };
  responsesExtensions?: {
    asyncToolCalling: boolean;
    midTurnSteering: boolean;
    configurationUpdates: boolean;
    misalignmentMonitoring: boolean;
  };
  dataHandling: {
    promptCaching: 'none' | 'provider_managed';
    batch: 'none' | 'provider_retained';
    remoteMcp: 'none' | 'third_party';
  };
}
```

`Model.features.promptCaching`, `batchAPI`, and `structuredOutput` describe the model catalog.
`getAdvancedCapabilities()` is more restrictive: it also verifies that the chosen adapter has a
wire mapping and usage/result conversion for that model family.

#### Provider orientation matrix

| Capability | OpenAI | Anthropic | Google |
|------------|--------|-----------|--------|
| Prompt caching | Implicit; normalized key/retention controls where supported | Request-controlled cache markers; short and extended TTL | Implicit hit reporting; normalized TTL control unavailable |
| Async text batch | Model-gated, up to capability-reported limit | Model-gated, up to capability-reported limit | Model-gated inline batch; one model per submission |
| Web search | Supported on declared Responses families | Supported on declared server-tool families | Supported on Gemini 2.5/3 text families |
| Web fetch | No standalone normalized tool | Supported on declared server-tool families | URL Context on Gemini 2.5/3 text families |
| Code execution | Code Interpreter | Server-side code execution | Gemini code execution |
| File search | Vector-store file search | Not normalized | Not normalized |
| Remote MCP | Supported without host-managed approval continuation | Supported on declared families; no normalized approval continuation | Not normalized |
| Native schema + tools | Supported when schema output is supported | Conservative final tool-free formatting for every tool mix | Gemini 3 text families only; otherwise final tool-free formatting |

This matrix is explanatory and can become stale as vendors change. Runtime code should branch on
the capability object, never the table.

### GPT-6 Astra Responses extensions

GPT-6 Astra adds Responses protocol features that are not ordinary sampling
options. OneRingAI supports them through direct Responses calls and a
connector-first WebSocket session. Check
`agent.getAdvancedCapabilities().responsesExtensions` before exposing the
features for a selected model.

#### Async function and custom tools

Set top-level `async: true` on a function or free-form custom tool definition.
The model may continue reasoning or answer independent parts while your
application runs the tool. When the work finishes, continue from the latest
response and return the result with the original `call_id`:

```typescript
import { Agent, ContentType, MessageRole, type Tool } from '@everworker/oneringai';

const agent = Agent.create({ connector: 'openai-main', model: 'gpt-6-astra' });
const astraInstructions = 'Produce a concise, sourced report.';
const astraAsyncTools = [{
  type: 'function',
  function: {
    name: 'slow_lookup',
    description: 'Run a long database lookup',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  async: true,
}] satisfies Tool[];

const first = await agent.runDirect('Start the report and run the slow lookup.', {
  instructions: astraInstructions,
  tools: astraAsyncTools,
});

const call = first.output
  .flatMap((item) => item.type === 'message' ? item.content : [])
  .find((content) => content.type === ContentType.TOOL_USE);

if (call?.type === ContentType.TOOL_USE && call.async) {
  const result = await runSlowLookup(JSON.parse(call.arguments));
  const continued = await agent.runDirect([{
    type: 'function_call_output',
    call_id: call.id,
    output: JSON.stringify(result),
  }], {
    previousResponseId: first.id,
    instructions: astraInstructions,
    tools: astraAsyncTools,
  });
  console.log(continued.output_text);
}
```

Use `custom_tool_call_output` for a custom tool. Async calling is supported for
application-executed function/custom tools, not provider-hosted tools or
programmatic tool calling. Multi-agent requests with async tools must set
`parallel_tool_calls: false`. This protocol flag is separate from OneRingAI's
`blocking: false`: the latter controls the managed `Agent.run()` tool loop;
protocol async calls use `runDirect()` / `streamDirect()` and host-managed
continuations.

#### Change reasoning effort without breaking the cached prefix

Add a `configuration_update` input item before the next user message. Its
reasoning effort persists for later continuations until replaced:

```typescript
const next = await agent.runDirect([
  { type: 'configuration_update', reasoning: { effort: 'high' } },
  {
    type: 'message',
    role: MessageRole.USER,
    content: [{ type: 'input_text', text: 'Now prove the difficult part.' }],
  },
], {
  previousResponseId: first.id,
  instructions: astraInstructions,
  tools: astraAsyncTools,
});
```

Only Astra supports this item, and only in standard single-agent responses.
Consecutive updates are rejected. It is
incompatible with automatic context management and `truncation: 'auto'`;
when explicit in-band compaction is needed, place one `compaction_trigger` as
the final input item, then send a fresh configuration update after compaction.
Direct responses retain encrypted compaction items in `response.output` in
provider order, and direct streams emit `StreamEventType.COMPACTION`, so
stateless applications can replay the canonical compacted state.
Astra accepts `low`, `medium`, `high`, `xhigh`, and `max`—not `none` or
`minimal`. OneRingAI also rejects Astra requests containing `temperature`,
`top_p`, `top_logprobs`, or `include: ['message.output_text.logprobs']`.

#### Mid-turn steering over WebSocket

Steering is Astra-only and requires the Responses WebSocket transport:

```typescript
import { OpenAIResponsesWebSocketSession } from '@everworker/oneringai';

const session = new OpenAIResponsesWebSocketSession({ connector: 'openai-main' });
session.on('error', console.error);
session.on('event', (event) => {
  if (event.type === 'response.created') console.log(event.response.id);
  if (event.type === 'response.steer.pending') {
    // Supply the required tool outputs once; never rerun already-started tools.
  }
});

await session.connect();
session.createResponse({
  model: 'gpt-6-astra',
  input: 'Draft the migration plan.',
  stream_id: 'planning',
});
session.steer('resp_active', 'Prioritize the zero-downtime path.');
```

Listen for `response.steer.accepted`, `.pending`, and `.failed`. Steering may
end the active response as `incomplete` with stop reason `steered`, followed by
an automatic successor. If `.pending` supplies required tool-result stubs,
fill them from saved results and send one explicit `response.create` for that
parent. The session deliberately exposes raw typed server events because the
application owns pending tools, approvals, lanes, and reconnect ambiguity.

#### Misalignment monitoring and safety alerts

Pre-stream and streamed `misalignment_policy_violation` failures map to
`ProviderMisalignmentError`, ahead of generic 403 authentication handling.
Stop consequential actions, preserve request/tool records, and do not retry
automatically. A `safety.alert.created` webhook can be correlated and retrieved
with a project API key that has `api.safety.alerts.read`:

```typescript
import {
  OpenAISafetyAPI,
  ProviderMisalignmentError,
} from '@everworker/oneringai';

try {
  await agent.runDirect('Continue the workflow');
} catch (error) {
  if (error instanceof ProviderMisalignmentError) {
    console.error(error.requestId, error.responseId);
  }
}

// After your webhook handler verifies safety.alert.created:
const alert = await new OpenAISafetyAPI('openai-main').retrieveAlert(alertId);
```

There is no generic resume operation after an alert; decide the next action in
trusted host code.

#### Fast mode and EU data residency

Request Fast mode with `vendorOptions: { serviceTier: 'fast' }` and inspect
`response.usage.service_tier` for the provider-reported tier. Astra Fast mode
is unavailable through the EU data residency endpoint. OneRingAI rejects
explicit `fast`/`priority` requests when the connector uses
`https://eu.api.openai.com/v1`; a project-level default is
still ultimately enforced by OpenAI because it is not visible in the request.

Official references: [latest model](https://developers.openai.com/api/docs/guides/latest-model),
[async tool calling](https://developers.openai.com/api/docs/guides/async-tool-calling),
[mid-turn steering](https://developers.openai.com/api/docs/guides/steering),
[reasoning configuration updates](https://developers.openai.com/api/docs/guides/reasoning#change-reasoning-mid-conversation),
[misalignment monitoring](https://developers.openai.com/api/docs/guides/safety-checks/misalignment-monitoring),
and [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode).

### Prompt caching

#### Policy contract

```typescript
type PromptCachePolicy =
  | { mode: 'off' }
  | {
      mode: 'auto';
      ttl?: 'short' | 'extended';
      key?: string;
      breakpointMode?: 'implicit' | 'explicit';
      strict?: boolean;
    };
```

`mode: 'auto'` asks OneRingAI to use the provider's supported caching mechanism. The meaning of the
optional fields is deliberately normalized:

| Field | Meaning |
|-------|---------|
| `ttl: 'short'` | Use the provider's default/short-lived cache behavior |
| `ttl: 'extended'` | Request the provider's supported extended retention mode |
| `key` | Stable routing/affinity key where the provider exposes one |
| `breakpointMode` | GPT-5.6+ implicit or explicit content-breakpoint selection |
| `strict: true` | Reject unsupported caching or TTL before inference instead of degrading |

Without `strict`, an unsupported cache request is removed and the call proceeds normally. If
caching is supported but the requested TTL is not, OneRingAI removes only the TTL and preserves the
remaining cache request/key.

```typescript
const response = await agent.run(largeInput, {
  promptCache: {
    mode: 'auto',
    ttl: 'extended',
    key: 'contracts-workflow-v7',
    strict: true,
  },
  dataHandling: { allowProviderCaching: true },
});

console.log({
  cacheHitTokens: response.usage.cached_input_tokens,
  cacheWriteTokens: response.usage.cache_creation_input_tokens,
  cacheWriteByTtl: response.usage.cache_creation_details,
});
```

`mode: 'off'` has a precise, limited meaning: **OneRingAI will not send provider cache controls for
that call.** OpenAI and Google can apply prompt caching implicitly to eligible ordinary requests;
the library cannot turn that provider behavior off. `allowProviderCaching: false` or omission also
blocks only caching explicitly requested/configured by this library. If policy requires a guarantee
of no provider-side caching, enforce it through the provider account/product configuration or choose
a provider/deployment with the required data posture.

#### Provider behavior

- **Anthropic:** `auto` emits an ephemeral cache control marker. `extended` selects the provider's
  extended TTL; usage can report both short- and extended-TTL cache creation.
- **OpenAI:** eligible prompts benefit from implicit caching. A normalized `key` and supported
  extended retention are mapped to Responses API controls. GPT-5.6+ can also
  mark supported input text/image/file blocks with
  `promptCacheBreakpoint: true`; set `breakpointMode: 'explicit'` to disable
  the automatic latest-message breakpoint. The default `implicit` mode keeps
  that automatic breakpoint and also honors caller-marked content blocks. The converter emits
  `prompt_cache_breakpoint: { mode: 'explicit' }` only when caching is enabled
  and the selected model reports `explicitBreakpoints`. Non-strict degradation
  removes both unsupported request controls and content-level markers.
- **Google:** eligible prompts may report implicit cached-content tokens. Explicit cached-content
  resource creation/lifecycle is not hidden behind this request policy and is not currently part of
  the normalized contract.

Prompt caching is prefix-oriented. Place stable instructions, policy text, schemas, and reference
material before the changing user-specific suffix. OneRingAI preserves caller order and does not
rewrite a prompt to improve hit rate.

Cache state belongs to the selected provider account/connector. OneRingAI does not implement a
cross-user semantic response cache and does not reuse provider credentials across connectors.

### Provider-hosted tools

Provider-hosted tools are different from `ToolFunction`s. A `ToolFunction` runs in your process under
`ToolManager`; a native tool is sent to and executed by the selected LLM provider.

```typescript
type NativeToolRequest =
  | { capability: 'web_search'; options?: Record<string, unknown> }
  | { capability: 'web_fetch'; options?: Record<string, unknown> }
  | { capability: 'code_execution'; options?: Record<string, unknown> }
  | { capability: 'file_search'; options: { vectorStoreIds: string[]; [key: string]: unknown } }
  | {
      capability: 'remote_mcp';
      server: {
        name: string;
        url: string;
        authorization?: { connector: string; accountId?: string };
        allowedTools?: string[];
        requireApproval?: 'always' | 'never';
      };
      options?: Record<string, unknown>;
    };
```

The `options` object is a provider-specific escape hatch for settings belonging to that normalized
tool. Fixed normalized fields win over conflicting values in `options`.

#### Web search, fetch, and code execution

```typescript
const response = await agent.run('Compare the latest three releases and cite sources', {
  nativeTools: [
    { capability: 'web_search', options: { max_uses: 4 } },
    { capability: 'web_fetch' },
    { capability: 'code_execution' },
  ],
  dataHandling: { allowProviderTools: true },
});

for (const item of response.output) {
  // Provider citations are retained on output-text annotations where available.
}
console.log(response.usage.native_tool_calls);
console.log(response.native_tool_events);
```

Unsupported tools fail with `ProviderCapabilityNotSupportedError`; OneRingAI never silently swaps a
native tool for a client-side search, fetch, shell, or MCP implementation.

#### File search

The normalized file-search contract currently targets OpenAI provider vector stores:

```typescript
await agent.run('Find the termination clause', {
  nativeTools: [{
    capability: 'file_search',
    options: { vectorStoreIds: ['vs_contracts'] },
  }],
  dataHandling: { allowProviderTools: true },
});
```

At least one `vectorStoreIds` entry is required. Validation happens before provider execution.

#### Remote MCP with connector-first authentication

Remote MCP never accepts a raw token in `RunOptions`. Reference a named connector instead:

```typescript
Connector.create({
  name: 'crm-mcp',
  vendor: Vendor.Custom,
  auth: { type: 'api_key', apiKey: process.env.CRM_MCP_TOKEN! },
});

const response = await agent.run('Find Acme and summarize the open opportunities', {
  nativeTools: [{
    capability: 'remote_mcp',
    server: {
      name: 'crm',
      url: 'https://mcp.example.com',
      authorization: { connector: 'crm-mcp' },
      allowedTools: ['find_customer', 'list_opportunities'],
      requireApproval: 'never',
    },
  }],
  dataHandling: { allowThirdPartyTools: true },
});
```

The security sequence is intentional:

1. Check the concrete model supports `remote_mcp`.
2. Require `allowThirdPartyTools: true`.
3. Reject `requireApproval: 'always'` unless the adapter exposes a host-managed continuation.
4. Validate the server URL and require HTTPS.
5. Resolve the named connector through the agent's scoped `IConnectorRegistry`.
6. Fetch the token for the current `userId`/`accountId` immediately before request conversion.
7. Send the resolved token only in the provider wire request.

Consequently, a rejected request does not fetch or refresh the connector token. A scoped registry
cannot fall back to a globally registered connector with the same name.

`requireApproval: 'always'` requires `remoteMcpApproval: true`; otherwise it is rejected before
credential resolution. `never` is the normalized no-approval execution path. OpenAI's provider
default requires approval, so omission is normalized to `never` until OneRingAI exposes the
`mcp_approval_response` continuation lifecycle.

#### Native-tool results and streaming

Non-streaming responses may include:

```typescript
interface NativeToolEvent {
  capability: string;
  id?: string;
  status?: string;
  error?: { code?: string; message: string; details?: unknown };
}
```

`native_tool_events` is diagnostic, not a host execution queue. Provider-native lifecycle and error
details vary by vendor. Streaming reports detailed usage on the terminal `response_complete` event,
but does not synthesize non-streaming `native_tool_events` for every intermediate provider event.

### Asynchronous text batches

Batch inference is intended for large offline workloads where provider latency is acceptable in
exchange for asynchronous processing and, where applicable, discounted token pricing.

#### Lifecycle

```typescript
interface IAsyncTextBatchProvider<TOptions, TResponse> {
  submitBatch(
    requests: Array<{ customId: string; options: TOptions }>,
    options?: BatchSubmitOptions,
  ): Promise<BatchHandle>;
  getBatch(id: string): Promise<BatchHandle>;
  cancelBatch(id: string): Promise<BatchHandle>;
  getBatchResults(id: string): AsyncIterable<BatchTextResult<TResponse>>;
}
```

```typescript
const batch = agent.getBatchProvider();
const caps = agent.getAdvancedCapabilities();
if (!caps.batch.supported || !batch) {
  throw new Error('No executable batch adapter for this provider/model');
}

// This Agent-bound surface injects the Agent's userId and scoped connector
// registry into every batch item before any remote-MCP credential is resolved.

const handle = await batch.submitBatch(
  [
    {
      customId: 'document-001',
      options: {
        model: agent.model,
        input: 'Summarize document 001',
        prompt_cache: { mode: 'auto', ttl: 'extended' },
        data_handling: { allowProviderCaching: true },
      },
    },
    {
      customId: 'document-002',
      options: {
        model: agent.model,
        input: 'Summarize document 002',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'summary',
            schema: {
              type: 'object',
              properties: { summary: { type: 'string' } },
              required: ['summary'],
              additionalProperties: false,
            },
          },
        },
      },
    },
  ],
  {
    completionWindow: caps.batch.completionWindow,
    metadata: { workflow: 'document-summaries' },
    dataHandling: { allowBatchRetention: true },
  },
);

await batchStore.save({
  provider: handle.provider,
  providerBatchId: handle.id,
  submittedAt: new Date().toISOString(),
  state: handle.state,
});
```

The host must persist the handle before treating submission as complete. OneRingAI does not include a
job scheduler, polling daemon, database, webhook receiver, or dead-letter queue.

#### Normalized states

| State | Meaning | Typical host action |
|-------|---------|---------------------|
| `queued` | Accepted but not processing | Persist and poll later |
| `in_progress` | Provider is processing items | Continue bounded polling |
| `completed` | Provider processing ended; individual items may still contain errors | Read and persist every result |
| `cancelling` | Cancellation requested but not terminal | Poll until terminal |
| `cancelled` | Provider reports cancellation | Read any available partial results |
| `expired` | Provider retention/processing window expired | Read available results, then dead-letter missing work |
| `failed` | Job-level failure | Inspect provider status and reconcile |

`requestCounts` can include total, processing, succeeded, failed, cancelled, and expired counts.
Do not infer that `state: 'completed'` means every item succeeded.

#### Correlated results

`customId` is the stable application correlation key. It must be non-empty and unique within one
submission.

```typescript
for await (const item of batch.getBatchResults(handle.id)) {
  if (item.response) {
    await resultStore.saveSuccess(item.customId, {
      providerRequestId: item.providerRequestId,
      text: item.response.output_text,
      usage: item.response.usage,
    });
  } else {
    await resultStore.saveFailure(item.customId, item.error);
  }
}
```

Each `BatchTextResult` has either `response` or `error`. Item errors preserve normalized code,
message, optional HTTP status, and provider-native diagnostic details. Result iteration can therefore
produce successes and failures together.

Successful batch responses set `usage.processing_mode = 'batch'`. This lets callers feed actual
usage directly into `calculateCost`.

#### Ambiguous submission safety

Batch creation is paid and is not safely retryable without reconciliation. A connection can fail
after the provider accepted the job but before the client received its ID.

```typescript
try {
  const handle = await batch.submitBatch(requests, {
    dataHandling: { allowBatchRetention: true },
  });
  await batchStore.save(handle);
} catch (error) {
  if (error instanceof ProviderAmbiguousOperationError) {
    await recoveryQueue.save({
      provider: error.providerName,
      operation: error.operation,
      recoveryMetadata: error.recoveryMetadata,
    });
    // Reconcile provider-side jobs/files before deciding whether to resubmit.
    throw error;
  }
  throw error;
}
```

OneRingAI disables SDK retries at known non-idempotent batch-creation boundaries. Do not wrap
`submitBatch` in a generic retry policy. OpenAI recovery metadata includes the uploaded input-file ID
when upload succeeded but batch creation became ambiguous; other providers retain submitted
correlation IDs/model information where available.

#### Validation before submission

Before the paid boundary, OneRingAI validates:

- non-empty request list;
- unique, non-empty `customId` values;
- provider/model batch support;
- supported completion window;
- `allowBatchRetention: true`;
- provider request options, native tools, data policy, and context limits;
- structured-output schema shape and native-vs-prompt strategy;
- named remote-MCP credentials, after all non-secret checks pass.

Anthropic and OpenAI can accept model choices supported by their provider batch contract. Google's
normalized inline batch requires one model for the whole submission. Provider-specific maximums are
reported in `capabilities.batch.maxRequests` when known.

### Data-handling policy

Advanced features can change where request data is processed or retained. OneRingAI therefore uses
explicit, fail-closed permissions:

```typescript
interface DataHandlingPolicy {
  allowProviderCaching?: boolean;
  allowBatchRetention?: boolean;
  allowProviderTools?: boolean;
  allowThirdPartyTools?: boolean;
}
```

| Permission | Required for | Omitted/false behavior |
|------------|--------------|------------------------|
| `allowProviderCaching` | `promptCache.mode: 'auto'` | Explicit cache request is rejected |
| `allowBatchRetention` | `submitBatch` | Submission is rejected |
| `allowProviderTools` | Native web search/fetch, code execution, file search | Tool request is rejected |
| `allowThirdPartyTools` | Remote MCP | MCP request is rejected before credentials are resolved |

These booleans authorize OneRingAI features; they are not a compliance engine. They do not override
provider account settings, regional routing, abuse monitoring, ordinary API retention, or implicit
prompt caching. Hosts should derive them from authenticated tenant policy rather than accepting them
directly from untrusted end-user input.

A conservative host pattern is:

```typescript
const policy: DataHandlingPolicy = {
  allowProviderCaching: tenant.aiPolicy.promptCaching,
  allowBatchRetention: tenant.aiPolicy.asyncRetention,
  allowProviderTools: tenant.aiPolicy.providerTools,
  allowThirdPartyTools: tenant.aiPolicy.thirdPartyMcp,
};

await agent.run(userPrompt, { nativeTools: approvedNativeTools, dataHandling: policy });
```

### Detailed usage and cost estimation

`LLMResponse.usage` retains detailed provider telemetry without discarding the common token totals:

```typescript
interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_details?: {
    short_ttl_input_tokens?: number;
    extended_ttl_input_tokens?: number;
  };
  output_tokens_details?: { reasoning_tokens: number };
  native_tool_calls?: Record<string, number | undefined>;
  processing_mode?: 'interactive' | 'batch';
  service_tier?: string;
}
```

Fields are absent when a provider does not report them; absence means unknown, not zero. Streaming
converters retain the same fields on the terminal `response_complete` event, and `StreamState`
accumulates them across agent iterations.

Agent execution metrics expose cumulative `cachedInputTokens`, `cacheCreationInputTokens`,
`reasoningTokens`, and `nativeToolCalls`. Structured-output formatting/repair generations contribute
to both response usage and execution metrics.

```typescript
const response = await agent.run('Analyze all records', options);
const usage = response.usage;

const estimatedCost = calculateCost(
  agent.model,
  usage.input_tokens,
  usage.output_tokens,
  {
    cachedInputTokens: usage.cached_input_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
    cacheCreationDetails: usage.cache_creation_details && {
      shortTtlInputTokens: usage.cache_creation_details.short_ttl_input_tokens,
      extendedTtlInputTokens: usage.cache_creation_details.extended_ttl_input_tokens,
    },
    processingMode: usage.processing_mode,
  },
);

console.log({ estimatedCost, metrics: agent.getMetrics() });
```

`input_tokens` is normalized to total processed input on every adapter; for Anthropic this includes
the provider's uncached, cache-read, and cache-creation buckets. `calculateCost` splits those buckets
instead of pricing the whole prompt at one rate and applies Anthropic's short/extended cache-write
multipliers when the creation breakdown is supplied.
`processingMode: 'batch'` applies the normalized batch discount only for registered OpenAI,
Anthropic, and Google models that advertise batch support. It returns `null` when the model or the
requested pricing mode is not represented safely in the registry.

Native-tool fees and non-token provider charges are reported as counts where possible but are not
automatically added to token cost estimates.

### Structured output interaction

Advanced capability discovery also describes how structured output composes with tools:

- `jsonObject` / `jsonSchema` report `native` or `prompt` for the concrete model.
- `nativeWithTools` reports whether the provider can enforce the native format while tools are
  offered in that request.
- `run()` can perform a final constrained, tool-free formatting pass when composition is unavailable.
- `stream()` cannot replace already-streamed text, so it logs a warning when tools prevent inline
  enforcement. Use `run()` when valid JSON is mandatory.
- Low-level and batch `response_format` requests are normalized before provider execution. An
  unsupported native schema becomes the prompt fallback; a missing/invalid schema fails before batch
  submission.

Non-streaming formatted responses expose:

```typescript
response.structured_output_enforcement;
// 'native' — provider-native format enforcement
// 'prompt' — strict prompt/final formatting pass
// 'repair' — at least one bounded repair generation was required
```

Prompt fallback guarantees parseable JSON, not local JSON Schema validation. Validate
`output_parsed` in application code when schema conformance is a hard boundary.

### Errors and troubleshooting

#### `ProviderCapabilityNotSupportedError`

Thrown before provider execution when a strict or retention-sensitive request cannot be honored.
The `capability` property is machine-readable enough to route common cases:

| Capability value pattern | Meaning |
|--------------------------|---------|
| `prompt_caching` | Strict caching requested on an unsupported model |
| `prompt_cache_ttl:<ttl>` | Strict TTL unavailable |
| `prompt_caching_blocked_by_data_policy` | Missing `allowProviderCaching` |
| `native_tool:<name>` | Tool unavailable for this provider/model |
| `native_tool:<name>_blocked_by_data_policy` | Missing `allowProviderTools` |
| `remote_mcp_blocked_by_data_policy` | Missing `allowThirdPartyTools` |
| `remote_mcp_invalid_url` / `remote_mcp_requires_https` | Invalid MCP endpoint |
| `remote_mcp_approval_policy` | Explicit approval choice unsupported |
| `batch` / `batch_completion_window:<window>` | Batch/model or window unsupported |
| `batch_blocked_by_data_policy` | Missing `allowBatchRetention` |
| `structured_output:json_schema_requires_schema` | Malformed low-level schema request |

Prefer capability discovery to exception-driven feature detection. Exceptions remain important for
race-free enforcement when a caller constructs options dynamically.

#### `ProviderAmbiguousOperationError`

This error means a paid/external mutation may have succeeded. It is intentionally distinct from a
normal provider failure. Persist `recoveryMetadata`, stop automatic retries, and reconcile.

#### Common mistakes

- **Caching request rejected:** set `dataHandling.allowProviderCaching: true`, or use
  `promptCache: { mode: 'off' }` if no explicit cache request is desired.
- **Extended TTL rejected:** inspect `promptCaching.ttlModes`; remove `strict` to allow TTL downgrade.
- **Native tool rejected:** inspect `nativeTools` for the exact agent model, not just the provider.
- **Remote MCP connector not found:** ensure the named connector exists in the agent's scoped
  registry and the current `userId`/`accountId` can obtain a token.
- **Remote MCP approval rejected:** use `requireApproval: 'never'`; `always` requires an adapter that
  reports `nativeToolOptions.remoteMcpApproval: true` and exposes a host continuation.
- **File search rejected:** pass a non-empty `vectorStoreIds` array.
- **Batch results unavailable:** poll `getBatch` until a terminal state; persist the handle between
  polls.
- **Batch duplicate work:** never blindly retry an ambiguous submission.
- **Streaming JSON invalid with tools:** use non-streaming `run()` so the final tool-free formatting
  pass can execute.
- **Usage detail missing:** the provider did not report that field; do not assume zero for billing.

### Production checklist

- Gate UI controls with `getAdvancedCapabilities()`.
- Derive `dataHandling` from trusted tenant policy.
- Keep connector tokens out of prompts, logs, and public run options.
- Persist batch handles and correlation IDs durably.
- Treat ambiguous batch submissions as reconciliation tasks, not retries.
- Store every batch item result independently; partial failure is normal.
- Validate `output_parsed` against your schema when correctness depends on it.
- Record detailed usage and provider-native tool counts for billing/audit.
- Re-check provider account retention, residency, and tool terms independently of library policy.

---

## Connectors & Authentication

### Creating Connectors

```typescript
import { Connector, Vendor } from '@everworker/oneringai';

// API Key Authentication
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// With custom base URL
Connector.create({
  name: 'openai-custom',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
  baseURL: 'https://custom-proxy.example.com/v1',
});

// Runtime-only rotating credentials (Vendor.OpenAI only)
Connector.create({
  name: 'openai-brokered',
  vendor: Vendor.OpenAI,
  auth: {
    type: 'api_key_provider',
    getApiKey: async () => credentialBroker.getOpenAIKey(),
  },
});

// With vendor-specific options
Connector.create({
  name: 'anthropic',
  vendor: Vendor.Anthropic,
  auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY! },
  options: {
    anthropicVersion: '2023-06-01'
  },
});
```

`api_key_provider` is host-local and cannot be saved through
`ConnectorConfigStore`. OpenAI text, image, audio, video, and embedding SDK
requests resolve and validate the callback when the SDK sends a request. The
Codex SDK runtime resolves it once when opening each Codex session. Empty or
whitespace-only values fail before reaching the SDK. Other vendors must use
their documented authentication forms.

### Preserving OAuth configuration and requesting refresh access

Use the provider template's `refreshStrategy` when a host requires reusable
authorization-code grants. The public `applyRefreshStrategy()` helper applies
only the provider's refresh requirements to the configuration you already have:

```typescript
import {
  applyRefreshStrategy,
  getVendorAuthTemplate,
  type OAuthConnectorAuth,
} from '@everworker/oneringai';

function requireRefreshAccess(
  auth: OAuthConnectorAuth,
  vendorId: string,
  authTemplateId: string,
): OAuthConnectorAuth {
  const template = getVendorAuthTemplate(vendorId, authTemplateId);
  if (auth.flow !== 'authorization_code' || template?.flow !== auth.flow) {
    throw new Error('Select the matching authorization-code template');
  }
  return {
    ...auth,
    ...applyRefreshStrategy(
      auth.scope,
      auth.authorizationParams,
      template.refreshStrategy,
      { enforce: true, requiredScope: auth.requiredScope },
    ),
  };
}
```

The helper is pure and idempotent. It preserves your API scopes, existing
required scope tokens and unrelated authorization parameters, including `prompt`.
It never copies the template's general scope list or prompt defaults. Its return
value is a config patch, not a token or a storage operation.

`auth.scope` is the authoritative scope field, including an explicitly empty
string. A legacy `authorizationParams.scope` is used only when `auth.scope` is
absent. The helper promotes that fallback into the returned `scope` and removes
the duplicate parameter. This prevents stale parameters from undoing scope edits
or reintroducing removed permissions. Authorization URL construction follows the
same precedence and always merges `requiredScope`, including for configurations
that bypass the helper. Unrelated parameters such as `prompt` remain unchanged.

| Template strategy | Effect |
| --- | --- |
| `scope` | Merge the provider-required scope tokens without duplicating them. |
| `auth_param` | Add the provider's required parameter. With `enforce: true`, replace a conflicting value; otherwise retain the existing value. |
| `automatic` / `never_expires` | No provider-specific request additions. |
| `manual_setup` | No invented request additions; the host must handle the documented provider setup. |

For example, the Google and Dropbox templates declare their respective offline
parameters; Microsoft, Salesforce and Twitter declare their respective refresh
scopes. Host code does not need a provider switch. Enforcement with no strategy
throws a configuration error. Existing three-argument calls keep their current
parameter precedence, including an explicitly configured online flow.

Enforcement requests the provider's renewal behavior; it does not guarantee a
refresh token on every callback. Providers can omit a replacement refresh token
after a subsequent authorization. Hosts must retain an existing valid grant for
the exact same account/client and must not confuse omission with disconnect.
`automatic`/`never_expires` describe the template's renewal model, not a promise
that consent or credentials cannot be revoked. `manual_setup` must be completed
outside the helper. No refresh scopes are added to app-only client-credentials
or JWT-bearer flows by this API integration.

`buildAuthConfig(template, credentials)` retains normal creation defaults.
For an existing same-method authorization-code connector, use
`buildAuthConfig(template, credentialPatch, { existingAuth })` instead.
Nonempty supplied template credentials replace their fields; empty values keep
the existing values, including secrets. Existing scopes, prompts, PKCE, token
storage namespace, refresh margin and custom endpoints survive the update.
An absent/empty saved scope does not import the template's broad scope list.
A changed parameter such as `tenantId` updates an endpoint only if that endpoint
still matches its previous template-derived URL; custom endpoints are preserved.

`ConnectorConfigStore.updateFromTemplate()` uses this preservation automatically.
An explicit provider/authentication-method change requires that method's own
required credentials and does not inherit the previous method's credentials.
Legacy configurations with matching provider and unambiguous method information
can be edited; ambiguous ones require an explicit `saveFromTemplate()` replacement.
The full-config `save()` API remains a replacement operation. A changed OAuth
client does not make the old client's user grants transferable.

Reconstructed `Connector` instances apply the same refresh requirements using
their canonical `serviceType`, even when `requiredScope` is already populated.
If a service has conflicting authorization-code strategies, automatic backfill
does not guess one: select the exact auth template and apply it explicitly as
shown above. This backfill does not import prompt or general scope defaults and
does not silently enable parameter enforcement for existing hosts.

### Multiple Keys Per Vendor

Use different keys for different purposes:

```typescript
// Main production key
Connector.create({
  name: 'openai-main',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_KEY_MAIN! },
});

// Backup key
Connector.create({
  name: 'openai-backup',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_KEY_BACKUP! },
});

// Use main key
const agent1 = Agent.create({ connector: 'openai-main', model: 'gpt-4.1' });

// Use backup key
const agent2 = Agent.create({ connector: 'openai-backup', model: 'gpt-4.1' });
```

### Managing Connectors

```typescript
// Check if connector exists
if (Connector.has('openai')) {
  console.log('OpenAI connector configured');
}

// Get a connector
const connector = Connector.get('openai');
console.log(connector.vendor); // 'openai'

// List all connectors
const names = Connector.list();
console.log(names); // ['openai', 'anthropic', 'google']

// Clear all (useful for testing)
Connector.clear();

// Get an IConnectorRegistry interface (unfiltered)
const registry = Connector.asRegistry();

// Create a scoped (filtered) view — see Scoped Connector Registry section
Connector.setAccessPolicy(myPolicy);
const scopedView = Connector.scoped({ tenantId: 'acme' });
```

### Supported Vendors

```typescript
import { Vendor } from '@everworker/oneringai';

Vendor.OpenAI        // OpenAI (GPT-4, GPT-5, o3-mini)
Vendor.Anthropic     // Anthropic (Claude)
Vendor.Google        // Google AI (Gemini)
Vendor.GoogleVertex  // Google Vertex AI
Vendor.Groq          // Groq (ultra-fast inference)
Vendor.Together      // Together AI
Vendor.Grok          // xAI (Grok)
Vendor.DeepSeek      // DeepSeek
Vendor.Mistral       // Mistral AI
Vendor.Perplexity    // Perplexity
Vendor.Ollama        // Ollama (local models)
Vendor.Custom        // Custom OpenAI-compatible endpoints
```

### DeepSeek connectors and hosted providers

`Vendor.DeepSeek` uses a dedicated provider with current model metadata,
reasoning/tool history handling, and both Chat Completions and Responses
transports. The official connector automatically uses Responses for all
current first-party V4 models, including
`deepseek-v4-flash`, `deepseek-v4-pro`, and `deepseek-v4-flash-vision-exp`.

```typescript
import {
  Agent,
  Connector,
  DEEPSEEK_HOSTS,
  LLM_MODELS,
  Vendor,
} from '@everworker/oneringai';

Connector.create({
  name: 'deepseek-main',
  vendor: Vendor.DeepSeek,
  auth: { type: 'api_key', apiKey: process.env.DEEPSEEK_API_KEY! },
});

const official = Agent.create({
  connector: 'deepseek-main',
  model: LLM_MODELS[Vendor.DeepSeek].DEEPSEEK_V4_FLASH,
});

Connector.create({
  name: 'deepseek-deepinfra',
  vendor: Vendor.DeepSeek,
  auth: { type: 'api_key', apiKey: process.env.DEEPINFRA_API_KEY! },
  options: { deepseekHost: DEEPSEEK_HOSTS.DeepInfra },
});
```

Available presets are `official`, `openrouter`, `together`, `fireworks`,
`deepinfra`, `nvidia-nim`, and `azure-foundry`. Azure needs its resource
endpoint in `baseURL`. For another OpenAI-compatible deployment, select
`custom` and provide `baseURL`. You may force `deepseekTransport` to
`responses` or `chat_completions`; `auto` is recommended. A canonical model
name is mapped to the selected host's model ID, while a host-specific deployment
ID passes through unchanged.

The connector-backed `DeepSeekAPI` facade exposes `listModels()`,
`createFimCompletion()`, and `getBalance()` without introducing a second source
of credentials:

```typescript
import { DeepSeekAPI } from '@everworker/oneringai';

const api = DeepSeekAPI.for('deepseek-main');
const models = await api.listModels();
const balance = await api.getBalance();
api.destroy();
```

FIM and balance are first-party account APIs and intentionally reject
third-party host presets. DeepSeek does not expose a first-party embeddings
endpoint; choose a separate embedding connector for memory and RAG.

---

## Agent Features

### Instructions (System Prompt)

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  instructions: `You are a Python programming expert.

                 Rules:
                 - Always provide working code examples
                 - Use type hints
                 - Include docstrings
                 - Follow PEP 8 style guide`,
});

const response = await agent.run('How do I read a CSV file?');
// Agent will provide Python code with all the rules applied
```

### Instruction Templates

Agent instructions support `{{COMMAND}}` and `{{COMMAND:arg}}` template placeholders that resolve automatically. Templates are processed in two phases:

- **Static** — resolved once when the agent is created (e.g., `AGENT_ID`, `MODEL`)
- **Dynamic** — resolved fresh before every LLM call (e.g., `DATE`, `TIME`, `RANDOM`)

#### Built-in Templates

| Template | Phase | Description |
|----------|-------|-------------|
| `{{AGENT_ID}}` | static | Agent's ID/name |
| `{{AGENT_NAME}}` | static | Agent's display name |
| `{{MODEL}}` | static | Current model (e.g., `gpt-4.1`) |
| `{{VENDOR}}` | static | Current vendor (e.g., `openai`) |
| `{{USER_ID}}` | static | Current user ID |
| `{{DATE}}` | dynamic | Current date — default `YYYY-MM-DD` |
| `{{DATE:format}}` | dynamic | Formatted date (e.g., `{{DATE:MM/DD/YYYY}}`, `{{DATE:DD.MM.YY}}`) |
| `{{TIME}}` | dynamic | Current time — default `HH:mm:ss` |
| `{{TIME:format}}` | dynamic | Formatted time (e.g., `{{TIME:hh:mm A}}` → `02:30 PM`) |
| `{{DATETIME}}` | dynamic | Combined — default `YYYY-MM-DD HH:mm:ss` |
| `{{DATETIME:format}}` | dynamic | Formatted (e.g., `{{DATETIME:YYYY/MM/DD HH:mm}}`) |
| `{{RANDOM}}` | dynamic | Random integer 1–100 |
| `{{RANDOM:min:max}}` | dynamic | Random integer in range (e.g., `{{RANDOM:1:10}}`) |

**Format tokens:** `YYYY`, `YY`, `MM`, `DD`, `HH` (24h), `hh` (12h), `mm`, `ss`, `A` (AM/PM), `a` (am/pm)

#### Basic Usage

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  name: 'research-assistant',
  userId: 'user-42',
  instructions: `You are {{AGENT_NAME}}, running on {{VENDOR}}/{{MODEL}}.
Today is {{DATE:MM/DD/YYYY}}. Current time: {{TIME:hh:mm A}}.
Assigned to user {{USER_ID}}.
Your session token is {{RANDOM:1000:9999}}.`,
});

// After creation, static templates are already resolved:
// "You are research-assistant, running on openai/gpt-4.1."
// Dynamic templates resolve on each LLM call:
// "Today is 04/12/2026. Current time: 02:30 PM."
```

#### Custom Handlers

Register your own template commands with `TemplateEngine.register()`. Handlers receive the arg string (after the colon) and a context object:

```typescript
import { TemplateEngine } from '@everworker/oneringai';

// Simple static handler (resolved once at agent creation)
TemplateEngine.register('COMPANY', () => 'Acme Corp');

// Handler with argument
TemplateEngine.register('GREET', (style, ctx) => {
  const name = (ctx.userName as string) ?? 'there';
  return style === 'casual' ? `Hey ${name}!` : `Good day, ${name}.`;
});
// Usage: {{GREET:casual}} → "Hey Alice!"

// Async dynamic handler (resolved every LLM call)
TemplateEngine.register('DB_COUNT', async (collection) => {
  const count = await db.collection(collection!).countDocuments();
  return String(count);
}, { dynamic: true });
// Usage: {{DB_COUNT:users}} → "4210"

// i18n translation handler
const translations = { en: { hello: 'Hello' }, es: { hello: 'Hola' } };
TemplateEngine.register('T', (key, ctx) => {
  const lang = (ctx.lang as string) ?? 'en';
  return translations[lang]?.[key ?? ''] ?? `[missing: ${key}]`;
});
// Usage: {{T:hello}} → "Hola" (when ctx.lang = 'es')
```

#### Overriding Built-in Handlers

Client apps can override any built-in handler. For example, to make `{{DATE}}` respect the user's timezone:

```typescript
import { TemplateEngine } from '@everworker/oneringai';

TemplateEngine.register('DATE', (fmt, ctx) => {
  const tz = (ctx.timezone as string) ?? 'UTC';
  const now = new Date();
  if (!fmt) {
    return now.toLocaleDateString('en-CA', { timeZone: tz });
  }
  // Custom format logic with timezone...
  return now.toLocaleDateString('en-US', { timeZone: tz });
}, { dynamic: true });
```

Overrides work regardless of registration order — user registrations always win over built-ins.

#### Escaping Templates

When you need to pass `{{...}}` literally to the LLM (e.g., to explain the template syntax itself), use one of two escape mechanisms:

**Triple braces** — for inline escaping:

```typescript
const instructions = `You are {{AGENT_ID}}.

When users ask about templates, tell them:
- {{{DATE}}} inserts the current date
- {{{RANDOM:min:max}}} generates a random number`;

// Resolves to:
// "You are my-agent."
// "- {{DATE}} inserts the current date"
// "- {{RANDOM:min:max}} generates a random number"
```

**Raw blocks** — for longer passages:

```typescript
const instructions = `Today is {{DATE}}.

{{raw}}
## Template Reference
{{DATE}} - Current date
{{TIME}} - Current time
{{AGENT_ID}} - Agent identifier
{{RANDOM:min:max}} - Random number
{{/raw}}`;

// {{DATE}} outside the raw block resolves normally.
// Everything inside {{raw}}...{{/raw}} is preserved verbatim.
```

#### How It Works

Templates are processed in two phases integrated into the agent lifecycle:

1. **Agent creation** (`Agent.create()`) — `TemplateEngine.processSync()` runs the **static** pass on `config.instructions`, resolving `AGENT_ID`, `MODEL`, `VENDOR`, `USER_ID`, and any custom static handlers.

2. **Before each LLM call** (`AgentContextNextGen.buildSystemMessage()`) — `TemplateEngine.process()` runs the **dynamic** pass, resolving `DATE`, `TIME`, `DATETIME`, `RANDOM`, and any custom dynamic handlers.

Unknown `{{COMMANDS}}` are left as-is — they won't cause errors and can coexist with other templating systems.

#### API Reference

```text
// Static API signatures
// Register a handler (overrides existing, including built-ins)
TemplateEngine.register(name: string, handler: TemplateHandler, options?: { dynamic?: boolean }): void;

// Unregister a handler
TemplateEngine.unregister(name: string): void;

// Check if a handler exists
TemplateEngine.has(name: string): boolean;

// List all registered handler names
TemplateEngine.getRegisteredHandlers(): string[];

// Process templates (async — supports async handlers)
await TemplateEngine.process(text, context?, { phase?: 'static' | 'dynamic' | 'all' }): Promise<string>;

// Process templates (sync — throws if a matched handler returns a Promise)
TemplateEngine.processSync(text, context?, { phase?: 'static' | 'dynamic' | 'all' }): string;

// Handler signature
type TemplateHandler = (arg: string | undefined, context: TemplateContext) => string | Promise<string>;

// Context passed to handlers
interface TemplateContext {
  agentId?: string;
  agentName?: string;
  model?: string;
  vendor?: string;
  userId?: string;
  [key: string]: unknown;  // custom fields
}
```

### Control Methods

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });

// Pause execution
agent.pause();

// Resume execution
agent.resume();

// Cancel current execution
agent.cancel();

// Check status
if (agent.isRunning()) {
  console.log('Agent is processing...');
}

if (agent.isPaused()) {
  console.log('Agent is paused');
}
```

### Metrics & Audit Trail

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });

await agent.run('Hello!');

// Get execution metrics
const metrics = agent.getMetrics();
console.log(metrics.iterationCount);    // 1
console.log(metrics.totalTokens);       // 150
console.log(metrics.totalDuration);     // 1200 (ms)

// Get audit trail
const audit = agent.getAuditTrail();
audit.forEach(entry => {
  console.log(`${entry.timestamp}: ${entry.type} - ${JSON.stringify(entry.details)}`);
});
```

### Cleanup

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });

// Register cleanup callback
agent.onCleanup(() => {
  console.log('Cleaning up resources...');
});

// Destroy agent
agent.destroy();
```

### Multi-User Support (`userId`)

For multi-user systems, set `userId` once at agent creation and it automatically flows to all tool executions via `ToolContext.userId` — no need to manually thread it through every call:

```typescript
// Set userId at creation
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'user-123',
  tools: [myTool],
});

// All tool executions automatically receive userId in their context
const myTool: ToolFunction = {
  definition: { /* ... */ },
  execute: async (args, context) => {
    console.log(context?.userId);  // 'user-123'
    // Use for per-user storage, OAuth tokens, audit trails, etc.
  },
};

// Change userId at runtime (e.g., when reusing agent across users)
agent.userId = 'user-456';

// Also accessible via context
console.log(agent.context.userId);  // 'user-456'
```

**What userId enables:**
- **Tool context** — Every `tool.execute(args, context)` receives `context.userId` automatically
- **Authenticated API calls** — All ConnectorTools (generic API, GitHub, etc.) use userId for per-user OAuth tokens at execution time
- **Connector registry** — `context.connectorRegistry` is scoped to the user when an access policy is set
- **Session metadata** — `userId` is automatically included when saving sessions
- **Per-user storage** — Multimedia tools organize output by userId when set

**Setting userId at different levels:**
```typescript
// Option 1: At agent level (recommended)
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1', userId: 'user-123' });

// Option 2: At context level
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: { userId: 'user-123' },
});

// Option 3: At runtime
agent.userId = 'user-123';
```

### Auth Identities (`identities`)

Restrict an agent to specific connectors (and optionally specific accounts). Only listed identities produce tool sets and are accessible in sandbox execution:

```typescript
import type { AuthIdentity } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'user-123',
  identities: [                       // Only these connectors available to tools
    { connector: 'github' },
    { connector: 'slack' },
    { connector: 'microsoft', accountId: 'work' },  // Specific account
  ],
  tools: [executeJavaScript],
});

// Tools only see github, slack, and microsoft (work account) — stripe, etc. are invisible
// This works with userId scoping: identities filter on top of access-policy view

// Change at runtime
agent.identities = [
  { connector: 'github' },
  { connector: 'slack' },
  { connector: 'stripe' },
];

// Remove restriction (all visible connectors available)
agent.identities = undefined;
```

**How it composes with access policies:**
1. Access policy filters connectors by userId (if set)
2. `identities` further restricts to named connectors (and accounts)
3. Result: only connectors matching identities AND visible to the user

**Available via `ToolContext.connectorRegistry`** — tools that need connector access (like `execute_javascript`) read the pre-built, scoped registry directly from their execution context.

---

## Session Persistence

Save and resume agent conversations across restarts using `AgentContextNextGen` and `FileContextStorage`.

### Quick Start

```typescript
import { AgentContextNextGen, createFileContextStorage } from '@everworker/oneringai';

// Create storage for the agent
const storage = createFileContextStorage('my-assistant');
// Sessions stored at: ~/.oneringai/agents/my-assistant/sessions/

// Create context with storage
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { workingMemory: true },
  storage,
});

// Build up state
ctx.addUserMessage('Remember: my name is Alice');
await ctx.memory?.store('user_name', 'User name', 'Alice');

// Save session
await ctx.save('session-001', { title: 'User Session' });

// Later... load session
const ctx2 = AgentContextNextGen.create({ model: 'gpt-4.1', storage });
const loaded = await ctx2.load('session-001');

if (loaded) {
  // Full state restored
  const name = await ctx2.memory?.retrieve('user_name');
  console.log(name); // 'Alice'
}
```

### Storage Backend: FileContextStorage

```typescript
import { FileContextStorage, createFileContextStorage } from '@everworker/oneringai';

// Simple: use helper function
const storage = createFileContextStorage('my-agent');

// Advanced: custom config
const storage = new FileContextStorage({
  agentId: 'my-agent',
  baseDirectory: '/custom/path/agents',  // Override default ~/.oneringai/agents
  prettyPrint: true,  // Human-readable JSON
});
```

**Storage Location:** `~/.oneringai/agents/<agentId>/sessions/<sessionId>.json`

### Custom Storage

Implement `IContextStorage` interface:

```typescript
import type { IContextStorage, StoredContextSession } from '@everworker/oneringai';

class DatabaseContextStorage implements IContextStorage {
  async save(sessionId: string, state: SerializedContextState, metadata?) { /* ... */ }
  async load(sessionId: string): Promise<StoredContextSession | null> { /* ... */ }
  async delete(sessionId: string) { /* ... */ }
  async exists(sessionId: string) { /* ... */ }
  async list(options?) { /* ... */ }
  getPath() { return 'database://...'; }
}
```

### Centralized Storage Registry

Instead of configuring each subsystem separately, use `StorageRegistry` to set storage backends in one call. Custom tools, media, sessions, context plugins, OAuth, routines, correlation records, agent/connector definitions, and permission rules consult the registry. Resolution can happen during construction or lazily at execution time depending on the subsystem; the table below records each actual default.

```typescript
import { StorageRegistry } from '@everworker/oneringai';

// Configure all storage backends at init time
StorageRegistry.configure({
  // Global singletons
  media: new S3MediaStorage(),
  oauthTokens: new FileTokenStorage({ directory: './tokens' }),

  // Context-aware factories (called with optional StorageContext for multi-tenant)
  customTools: (ctx) => new MongoCustomToolStorage(ctx?.userId),
  sessions: (agentId) => new RedisContextStorage(agentId),
  persistentInstructions: (agentId) => new DBInstructionsStorage(agentId),
  workingMemory: () => new RedisMemoryStorage(),
  userInfo: (ctx) => new MongoUserInfoStorage(ctx?.userId),
  routineDefinitions: (ctx) => new MongoRoutineDefinitionStorage(ctx?.userId),
  routineExecutions: (ctx) => new MongoRoutineExecutionStorage(ctx?.userId),

  // Additional global backends
  correlations: new MongoCorrelationStorage(),
  permissionRules: new MongoPermissionRulesStorage(),
});

// That's it! All agents, tools, and plugins will use these backends automatically.
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });
```

**Resolution order** (every subsystem follows this):
1. Explicit parameter passed to constructor/factory (e.g., `createCustomToolMetaTools({ storage })`)
2. Value registered in `StorageRegistry`
3. Built-in file-based (or in-memory) default

**No breaking changes** — `setMediaStorage()`, `Connector.setDefaultStorage()`, and all explicit constructor params continue to work exactly as before. They now delegate to the registry internally.

**Available storage keys:**

| Key | Type | Default | Consumed By |
|-----|------|---------|-------------|
| `customTools` | `(ctx?) => ICustomToolStorage` | `FileCustomToolStorage` | `custom_tool_save/list/load/delete` meta-tools |
| `media` | `IMediaStorage` | `FileMediaStorage` | Image/video/TTS output tools |
| `oauthTokens` | `ITokenStorage` | `MemoryStorage` | `Connector` OAuth token persistence |
| `agentDefinitions` | `IAgentDefinitionStorage` | — | `Agent.saveDefinition()`, `Agent.fromStorage()` |
| `connectorConfig` | `IConnectorConfigStorage` | — | `ConnectorConfigStore.create()` |
| `sessions` | `(agentId, ctx?) => IContextStorage` | — | `AgentContextNextGen` constructor |
| `persistentInstructions` | `(agentId, ctx?) => IPersistentInstructionsStorage` | `FilePersistentInstructionsStorage` | `PersistentInstructionsPluginNextGen` |
| `workingMemory` | `(ctx?) => IMemoryStorage` | `InMemoryStorage` | `WorkingMemoryPluginNextGen` |
| `userInfo` | `(ctx?) => IUserInfoStorage` | `FileUserInfoStorage` | `UserInfoPluginNextGen` |
| `routineDefinitions` | `(ctx?) => IRoutineDefinitionStorage` | `FileRoutineDefinitionStorage` | Routine definition persistence |
| `routineExecutions` | `(ctx?) => IRoutineExecutionStorage` | — | Routine execution detail/list tools |
| `correlations` | `ICorrelationStorage` | — | Agent correlation/result routing |
| `permissionRules` | `IUserPermissionRulesStorage` | — | Persistent per-user permission rules |

**Individual access:**

```typescript
// Set one backend
StorageRegistry.set('media', new S3MediaStorage());

// Get (returns undefined if not configured)
const storage = StorageRegistry.get('customTools');

// Check if configured
if (StorageRegistry.has('sessions')) { /* ... */ }

// Reset all (useful in tests)
StorageRegistry.reset();
```

**Multi-Tenant / Multi-User:**

Per-agent factories receive an optional `StorageContext` — an opaque object (like `ConnectorAccessContext`) that carries userId, tenantId, or any custom fields:

```typescript
import { StorageRegistry } from '@everworker/oneringai';

// Configure factories that partition by tenant
StorageRegistry.configure({
  sessions: (agentId, ctx) => new TenantSessionStorage(agentId, ctx?.tenantId as string),
  persistentInstructions: (agentId, ctx) => new TenantInstructionsStorage(agentId, ctx?.userId as string),
  workingMemory: (ctx) => new TenantMemoryStorage(ctx?.tenantId as string),
});

// Set the context globally (e.g., at app startup or per-request)
StorageRegistry.setContext({ userId: 'alice', tenantId: 'acme-corp' });

// All agents now get tenant-scoped storage automatically
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1', userId: 'alice' });
```

If no global context is set, `AgentContextNextGen` derives `{ userId }` for the `sessions` factory. Custom-tool, user-info, and routine tools can derive `{ userId }` from their per-call `ToolContext`. The `workingMemory` and `persistentInstructions` factories receive only `StorageRegistry.getContext()` and have no per-instance fallback, so call `StorageRegistry.setContext({ userId, tenantId })` when those backends must be partitioned. Because the registry context is process-global, request-concurrent multi-tenant servers should prefer explicitly scoped factories/instances over mutating global context during overlapping requests.

### Session Management APIs

```typescript
// Check if session exists
const exists = await ctx.sessionExists('session-001');

// Delete session
await ctx.deleteSession('session-001');

// Get current session ID
console.log(ctx.sessionId);  // 'session-001' or null

// List all sessions for this agent
const sessions = await storage.list();
for (const s of sessions) {
  console.log(`${s.sessionId}: ${s.metadata?.title} (${s.messageCount} messages)`);
}
```

### Using with Agent

```typescript
import { Agent, createFileContextStorage } from '@everworker/oneringai';

const storage = createFileContextStorage('my-agent');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    agentId: 'my-agent',
    features: { workingMemory: true },
    storage,
  },
});

// Run agent
await agent.run('Remember: my favorite color is blue');

// Save session
await agent.context.save('session-001');

// Later... load session
await agent.context.load('session-001');
await agent.run('What is my favorite color?');
// Output: "Your favorite color is blue."
```

### What Gets Persisted

| Component | Persisted? | Notes |
|-----------|------------|-------|
| Conversation history | ✅ | All messages with timestamps |
| WorkingMemory entries | ✅ | Full values, not just index |
| InContextMemory entries | ✅ | Via plugin state |
| Tool enable/disable state | ❌ | `ToolManager.getState()/loadState()` exist but are not wired into `ctx.save()`/`ctx.load()` — persist/restore separately if needed |
| System prompt | ✅ | |


### AgentContextNextGen Session Persistence

The recommended approach to session persistence using `AgentContextNextGen`:

```typescript
import { AgentContextNextGen, createFileContextStorage } from '@everworker/oneringai';

// Create storage for the agent
const storage = createFileContextStorage('my-assistant');
// Sessions stored at: ~/.oneringai/agents/my-assistant/sessions/

// Create context with storage
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { workingMemory: true, inContextMemory: true },
  storage,
});

// Build up state
ctx.addUserMessage('My name is Alice and I prefer dark mode.');
ctx.addAssistantResponse({ output_text: 'Nice to meet you, Alice!' });
await ctx.memory?.store('user_name', 'User name', 'Alice');
await ctx.memory?.store('user_pref', 'User preferences', { theme: 'dark' });

// Save session with metadata
// Note: this metadata is merged into the serialized state's internal
// `metadata` field, NOT into StoredContextSession.metadata (the field
// storage.list() uses for s.metadata?.title / tags filtering below).
// To make title/tags queryable via storage.list(), call
// storage.updateMetadata(sessionId, { title, tags }) as well.
await ctx.save('session-001', {
  title: 'Alice Support Chat',
  tags: ['support', 'vip'],
});

console.log(ctx.sessionId);  // 'session-001'
```

#### Loading Sessions

```typescript
// Create new context and load
const ctx2 = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { workingMemory: true, inContextMemory: true },
  storage,
});

const loaded = await ctx2.load('session-001');

if (loaded) {
  // Everything is restored:
  const conversation = ctx2.getConversation();
  console.log(conversation[0]);  // User message about Alice

  const name = await ctx2.memory?.retrieve('user_name');
  console.log(name);  // 'Alice'

  const prefs = await ctx2.memory?.retrieve('user_pref');
  console.log(prefs);  // { theme: 'dark' }
}
```

#### What Gets Persisted

| Component | Persisted? | Notes |
|-----------|------------|-------|
| Conversation history | ✅ | All messages with timestamps |
| WorkingMemory entries | ✅ | **Full values**, not just index |
| Tool enable/disable state | ❌ | `ToolManager.getState()/loadState()` exist but are not wired into `ctx.save()`/`ctx.load()` — persist/restore separately if needed |
| Permission approvals | ❌ | `ToolPermissionManager.getState()/loadState()` exist but are not wired into `ctx.save()`/`ctx.load()` — persist/restore separately if needed |
| InContextMemory entries | ✅ | Via plugin state |
| System prompt | ✅ | |
| Instructions | ✅ | |

#### Session Management APIs

```typescript
// Check if session exists
const exists = await ctx.sessionExists('session-001');

// Delete session
await ctx.deleteSession('session-001');

// Delete current session
await ctx.deleteSession();  // Uses ctx.sessionId

// List all sessions for this agent
const sessions = await storage.list();
for (const s of sessions) {
  console.log(`${s.sessionId}: ${s.metadata?.title} (${s.messageCount} messages)`);
}

// List with filtering
const recentSessions = await storage.list({
  savedAfter: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),  // Last week
  tags: ['support'],
  limit: 10,
});
```

#### Storage Backends

**FileContextStorage** (default):
```typescript
import { FileContextStorage, createFileContextStorage } from '@everworker/oneringai';

// Simple: use helper
const storage = createFileContextStorage('my-agent');

// Advanced: custom config
const storage = new FileContextStorage({
  agentId: 'my-agent',
  baseDirectory: '/custom/path/agents',  // Override default ~/.oneringai/agents
  prettyPrint: true,  // Human-readable JSON
});
```

**Custom Storage** (implement `IContextStorage`):
```typescript
import type { IContextStorage, StoredContextSession } from '@everworker/oneringai';

class RedisContextStorage implements IContextStorage {
  async save(sessionId: string, state: SerializedContextState, metadata?) { /* ... */ }
  async load(sessionId: string): Promise<StoredContextSession | null> { /* ... */ }
  async delete(sessionId: string) { /* ... */ }
  async exists(sessionId: string) { /* ... */ }
  async list(options?) { /* ... */ }
  getPath() { return 'redis://...'; }
}
```

### Agent Definition Persistence (NEW)

Store agent **configuration** separately from sessions for easy instantiation:

```typescript
import { Agent, createFileAgentDefinitionStorage } from '@everworker/oneringai';

const defStorage = createFileAgentDefinitionStorage();
// Stores at: ~/.oneringai/agents/<agentId>/definition.json

// Create and configure agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  instructions: 'You are a helpful support assistant.',
  context: {
    agentId: 'support-bot',
    features: { workingMemory: true, persistentInstructions: true }
  }
});

// Save definition with metadata
await agent.saveDefinition(defStorage, {
  description: 'Customer support chatbot',
  tags: ['support', 'production'],
  author: 'Team A'
});
```

#### Loading Agents from Definitions

```typescript
// Later: recreate agent from stored definition
const restored = await Agent.fromStorage('support-bot', defStorage);

if (restored) {
  // Agent has same model, instructions, features as when saved
  const response = await restored.run('Hello!');
}

// With config overrides
const devAgent = await Agent.fromStorage('support-bot', defStorage, {
  model: 'gpt-5.6-luna',  // Override with an economical current model
});
```

#### Listing Agent Definitions

```typescript
const definitions = await defStorage.list();

for (const def of definitions) {
  console.log(`${def.agentId}: ${def.name}`);
  console.log(`  Type: ${def.agentType}, Model: ${def.model}`);
  console.log(`  Created: ${def.createdAt}`);
}

// Filter by type
const taskAgents = await defStorage.list({ agentType: 'task-agent' });
```

#### Storage Structure

```
~/.oneringai/agents/
├── support-bot/
│   ├── definition.json          # Agent configuration
│   ├── custom_instructions.json  # Persistent instructions (if enabled)
│   └── sessions/
│       ├── _index.json          # Session index for fast listing
│       ├── session-001.json     # Full session state
│       └── session-002.json
├── research-bot/
│   ├── definition.json
│   └── sessions/
│       └── ...
└── _agents_index.json           # Agent definitions index
```


## Context Management

The library includes a **powerful, universal context management system** that automatically handles the complexity of managing LLM context windows. `AgentContextNextGen` is the primary context manager with a clean, plugin-based architecture.

### AgentContextNextGen - The Modern API

**AgentContextNextGen** is the modern, plugin-first context manager. It provides clean separation of concerns with composable plugins:

#### What the plugin architecture is for

A context plugin is a bounded capability, not just a prompt fragment. A plugin
can own all of the following as one lifecycle unit:

| Responsibility | Why it belongs in the plugin |
|----------------|------------------------------|
| Static instructions | Teaches the model when and how to use the capability |
| Dynamic context content | Injects only the state needed for the current call |
| Tools | Makes feature-specific operations available through the shared `ToolManager` |
| Token accounting | Lets the context budget show exactly what each capability costs |
| Compaction | Lets a feature reduce its own content safely when the context fills |
| Persistence | Saves and restores plugin state with the conversation session |
| Cleanup | Releases resources through the common `IDisposable` lifecycle |

`AgentContextNextGen.prepare()` assembles one system message from the enabled
plugins and compacts at most once immediately before the LLM call. Conversation
tool-call/result pairs remain atomic, the newest input is never compacted, and
disabling a feature removes its prompt content and feature tools.

The word “memory” appears in several plugin names because they solve different
problems:

| Use case | Choose | Data location / retrieval model |
|----------|--------|---------------------------------|
| Scratch notes and large intermediate findings | `WorkingMemoryPluginNextGen` | Values live outside the prompt; an index is injected and the agent retrieves details with `store_*` |
| Small state the model must always see | `InContextMemoryPluginNextGen` | Full values live directly in the prompt |
| Durable people, organizations, tasks, events, documents, relationships, and learned profiles | `MemoryPluginNextGen` | Standalone entity/fact system with ranked, graph, vector, and bitemporal retrieval |
| Let the LLM mutate durable memory | `MemoryWritePluginNextGen` | Six controlled write tools layered on the read plugin |
| Learn from conversations without LLM write tools | `SessionIngestorPluginNextGen` | Background extraction into the same `MemorySystem` |

See the [Memory Layer Guide](./docs/MEMORY_GUIDE.md) for the standalone system
and the [Self-Learning Memory](#self-learning-memory-nextgen-plugin) section for
agent wiring.

```typescript
import { AgentContextNextGen } from '@everworker/oneringai';

// Create a context instance
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  systemPrompt: 'You are a helpful assistant.',
  features: {
    workingMemory: true,      // WorkingMemoryPluginNextGen
    inContextMemory: true,    // InContextMemoryPluginNextGen
    persistentInstructions: false,
  },
  strategy: 'algorithmic', // Default strategy (75% threshold)
});

// Add user message
ctx.addUserMessage('What is the weather in Paris?');

// Prepare context for LLM call (handles compaction if needed)
const { input, budget, compacted } = await ctx.prepare();

// After LLM call, add response
ctx.addAssistantResponse(response.output);

// Add tool results
ctx.addToolResults([{ tool_use_id: '...', content: '...', state: ToolCallState.COMPLETED }]);

// Access plugins
const memory = ctx.memory;  // WorkingMemoryPluginNextGen | null
await memory?.store('key', 'description', value);

// Access tools
ctx.tools.disable('risky_tool');

// Budget information
console.log(`Tokens: ${budget.totalUsed}/${budget.maxTokens}`);
console.log(`Utilization: ${budget.utilizationPercent}%`);
console.log(`Available: ${budget.available}`);
```

### Semantic Rollover at Provider-Session Boundaries

Automatic compaction is token-triggered. Use explicit rollover when the
provider session itself must be replaced—for example, before OpenAI Realtime's
hard session lifetime—but the same OneRingAI Agent should continue:

```typescript
const result = await agent.rolloverContext({
  preserveRecentTurns: 8,
  maxSummaryTokens: 2048,
  reason: 'provider-session-expiring',
});
```

The Agent obtains its normal exclusive execution lease, loads persisted state,
summarizes the older prefix with a tool-free direct call, and commits a
developer continuity brief only after a non-empty summary succeeds. Recent
turns and complete tool-call/result pairs remain exact. Plugin state and the
append-only history journal are not compacted. With session storage,
`checkpoint` defaults to `true`; without it, checkpointing defaults to `false`.

Use a trusted custom summarizer when the Agent model is not text-capable or the
summary must run through another service:

```typescript
await agent.rolloverContext({
  summarize: async ({ items, estimatedTokens, preservedRecentTurns, reason }) =>
    summaryService.createContinuityBrief({
      items,
      estimatedTokens,
      preservedRecentTurns,
      reason,
    }),
});
```

The lower-level context API requires the summarizer explicitly:

```typescript
const result = await agent.context.rollover({
  preserveRecentTurns: 8,
  reason: 'manual-handoff',
  summarize: ({ items }) => summarizeWithTrustedModel(items),
});
```

Call either API only between turns, with no pending input. Agent-level rollover
cannot overlap `run()`, `stream()`, async continuation, or external execution;
context-level rollover rejects concurrent rollover and aborts if the live
context changes while the summary is being generated. Observe committed
rollovers with `context:rolled_over` and inspect the returned token/item counts.

### Context Structure

AgentContextNextGen organizes context into clear sections:

```
[Developer Message - All glued together]
  # System Prompt
  # Persistent Instructions (if plugin enabled)
  # Plugin Instructions (for enabled plugins)
  # In-Context Memory (if plugin enabled)
  # Working Memory Index (if plugin enabled)

[Conversation History]
  ... messages including tool_use/tool_result pairs ...

[Current Input]
  User message OR tool results (newest, never compacted)
```

#### AgentContextNextGen Components

AgentContextNextGen uses a plugin architecture with these core components:

| Component | Access | Purpose |
|-----------|--------|---------|
| **ToolManager** | `ctx.tools` | Tool registration, execution, circuit breakers |
| **WorkingMemoryPluginNextGen** | `ctx.getPlugin('working_memory')` | Tiered memory (raw/summary/findings) |
| **InContextMemoryPluginNextGen** | `ctx.getPlugin('in_context_memory')` | Live key-value storage in context |
| **PersistentInstructionsPluginNextGen** | `ctx.getPlugin('persistent_instructions')` | Disk-persisted agent instructions |
| **UserInfoPluginNextGen** | `ctx.getPlugin('user_info')` | User-scoped preferences + TODO tracking, auto-injected into context |
| **ToolCatalogPluginNextGen** | `ctx.getPlugin('tool_catalog')` | Scoped discovery and dynamic loading/unloading of tool categories |
| **SharedWorkspacePluginNextGen** | `ctx.getPlugin('shared_workspace')` | Versioned multi-agent coordination board |
| **MemoryPluginNextGen** | `ctx.getPlugin('memory')` | Profile injection plus six graph/vector/document retrieval tools |
| **MemoryWritePluginNextGen** | `ctx.getPlugin('memory_write')` | Six controlled durable-memory mutation tools |
| **SessionIngestorPluginNextGen** | Manually registered | Optional background extraction from accumulated conversation turns |
| **Conversation** | `ctx.getConversation()` | Built-in conversation tracking (Message[]) |

#### Using AgentContextNextGen with Agent

**AgentContextNextGen is always available** - BaseAgent creates it in the constructor, making it the single source of truth for ToolManager:

```typescript
import { Agent, AgentContextNextGen } from '@everworker/oneringai';

// AgentContextNextGen is auto-created with default config
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool],
  context: {
    strategy: 'algorithmic',    // Default strategy: algorithmic compaction at 75% threshold
    features: { workingMemory: true },
  },
});

// UNIFIED TOOL MANAGEMENT: agent.tools and agent.context.tools are the SAME instance
console.log(agent.tools === agent.context.tools);  // true
console.log(agent.hasContext());  // Always true

// Tool changes via either path are immediately reflected
agent.tools.disable('weather_tool');
console.log(agent.context.tools.listEnabled().includes('weather_tool'));  // false

agent.context.tools.enable('weather_tool');
console.log(agent.tools.listEnabled().includes('weather_tool'));  // true

// Agent automatically tracks messages and tool calls
await agent.run('What is the weather?');

// Access the context (never null)
const ctx = agent.context;
const conversation = ctx.getConversation(); // Message[] - NextGen API
const { budget } = await ctx.prepare();
console.log(`Used: ${budget.totalUsed}/${budget.maxTokens} tokens`);

// Option 2: Pass existing AgentContextNextGen instance
const sharedContext = AgentContextNextGen.create({ model: 'gpt-4.1' });
const agent1 = Agent.create({ connector: 'openai', model: 'gpt-4.1', context: sharedContext });
const agent2 = Agent.create({ connector: 'anthropic', model: 'claude-sonnet-5', context: sharedContext });
// Both agents share the same context state and ToolManager!
```

#### AgentContextNextGen Configuration

```typescript
interface AgentContextNextGenConfig {
  /** Model name (used for token limits) — REQUIRED */
  model: string;

  /** Max context tokens (overrides model default) */
  maxContextTokens?: number;

  /** Response token reserve in tokens (default: 4096) */
  responseReserve?: number;

  /** System prompt */
  systemPrompt?: string;

  /** Agent ID (used for persistent storage paths) */
  agentId?: string;

  /** Tools to register */
  tools?: ToolFunction[];

  /** Feature flags for enabling/disabling plugins */
  features?: ContextFeatures;

  /** Compaction strategy */
  strategy?: string;  // 'algorithmic' (default, 75%) or custom registered strategy name

  /** Context storage for session persistence */
  storage?: IContextStorage;

  /** Plugin configurations */
  plugins?: PluginConfigs;
}

interface ContextFeatures {
  /** Enable WorkingMemoryPluginNextGen (default: true) */
  workingMemory?: boolean;

  /** Enable InContextMemoryPluginNextGen (default: true) */
  inContextMemory?: boolean;

  /** Enable PersistentInstructionsPluginNextGen (default: false) */
  persistentInstructions?: boolean;

  /** Enable UserInfoPluginNextGen (default: false) */
  userInfo?: boolean;

  /** Enable ToolCatalogPluginNextGen for dynamic tool loading/unloading (default: false) */
  toolCatalog?: boolean;

  /** Enable SharedWorkspacePluginNextGen (default: false) */
  sharedWorkspace?: boolean;

  /** Enable MemoryPluginNextGen read tools/profile injection (default: false) */
  memory?: boolean;

  /** Enable MemoryWritePluginNextGen write tools (default: false; requires memory) */
  memoryWrite?: boolean;
}
```

#### Feature Configuration

AgentContextNextGen features enable plugins independently. When a feature is disabled, its associated tools are **not registered**, giving the LLM a cleaner tool set:

```typescript
import { AgentContextNextGen, DEFAULT_FEATURES } from '@everworker/oneringai';

// View default feature settings
console.log(DEFAULT_FEATURES);
// { workingMemory: true, inContextMemory: true, persistentInstructions: false, userInfo: false, toolCatalog: false, sharedWorkspace: false, memory: false, memoryWrite: false }
```

**Available Features:**

| Feature | Default | Plugin | When Disabled |
|---------|---------|--------|---------------|
| `workingMemory` | `true` | WorkingMemoryPluginNextGen - tiered memory (raw/summary/findings) | `store_*` tools cannot target `"notes"` store; `ctx.memory` returns `null` |
| `inContextMemory` | `true` | InContextMemoryPluginNextGen - live key-value storage directly in context | `store_*` tools cannot target `"whiteboard"` store |
| `persistentInstructions` | `false` | PersistentInstructionsPluginNextGen - agent instructions persisted to disk (KVP entries) | `store_*` tools cannot target `"instructions"` store |
| `userInfo` | `false` | UserInfoPluginNextGen - user-scoped preferences + TODO tracking auto-injected into context | `store_*` tools cannot target `"user_info"` store; `todo_*` tools not registered |
| `toolCatalog` | `false` | ToolCatalogPluginNextGen - dynamic tool loading/unloading by category | `tool_catalog_*` tools not registered; all tools must be pre-loaded |
| `sharedWorkspace` | `false` | SharedWorkspacePluginNextGen - versioned multi-agent coordination board | `store_*` tools cannot target `"workspace"` |
| `memory` | `false` | MemoryPluginNextGen - profile injection and six read tools | No durable graph/vector memory content or `memory_*` read tools; requires `plugins.memory.memory` when enabled |
| `memoryWrite` | `false` | MemoryWritePluginNextGen - six controlled write tools | Agent remains unable to mutate durable memory; requires `memory: true` when enabled |

**Usage Examples:**

```typescript
// 1. Minimal stateless agent (no working memory)
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { workingMemory: false },  // Disable working memory
});

console.log(ctx.memory);  // null

// 2. Full-featured agent with all capabilities
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: {
    workingMemory: true,          // default: true
    inContextMemory: true,        // default: true
    persistentInstructions: true, // default: false
    userInfo: true,               // default: false
  },
});

// 3. Via Agent.create() - inline config
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    features: { workingMemory: false },  // Disable working memory
  },
});

// 4. Agent with all features
const fullAgent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'alice',  // Optional for userInfo isolation
  context: {
    agentId: 'my-agent',
    features: {
      workingMemory: true,
      inContextMemory: true,
      persistentInstructions: true,
      userInfo: true,
    },
  },
});
```

**Feature-Aware APIs:**

```typescript
// Check if a feature is enabled
ctx.features.workingMemory;           // boolean
ctx.features.inContextMemory;         // boolean
ctx.features.persistentInstructions;  // boolean
ctx.features.userInfo;                // boolean

// Get read-only feature configuration
ctx.features; // also includes sharedWorkspace, memory, memoryWrite, and registered external feature keys

// Access nullable memory
ctx.memory;  // WorkingMemoryPluginNextGen | null

// Access plugins by name
ctx.getPlugin('working_memory');            // WorkingMemoryPluginNextGen | null
ctx.getPlugin('in_context_memory');         // InContextMemoryPluginNextGen | null
ctx.getPlugin('persistent_instructions');   // PersistentInstructionsPluginNextGen | null
ctx.getPlugin('user_info');                 // UserInfoPluginNextGen | null
ctx.getPlugin('tool_catalog');              // ToolCatalogPluginNextGen | null
ctx.getPlugin('shared_workspace');          // SharedWorkspacePluginNextGen | null
ctx.getPlugin('memory');                    // MemoryPluginNextGen | null
ctx.getPlugin('memory_write');              // MemoryWritePluginNextGen | null

// Check if plugin exists
ctx.hasPlugin('working_memory');  // boolean
```

**Tool Auto-Registration:**

AgentContextNextGen automatically registers feature-aware tools based on enabled features:

```typescript
import { AgentContextNextGen } from '@everworker/oneringai';

// With workingMemory enabled (default)
const ctx = AgentContextNextGen.create({ model: 'gpt-4.1' });
console.log(ctx.tools.has('store_set'));     // true (store_* tools registered)

// With workingMemory disabled - memory store not available
const ctx2 = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { workingMemory: false },
});
// store_* tools are still registered, but store_set("notes", ...) will fail
```

**Tools registered by feature:**

All plugin stores are accessed through 5 unified `store_*` tools: `store_get`, `store_set`, `store_delete`, `store_list`, `store_action`. Each feature flag enables its corresponding store:

- **workingMemory=true** (default): enables `"notes"` store (e.g., `store_set("notes", key, { description, value })`)
- **inContextMemory=true**: enables `"whiteboard"` store (e.g., `store_set("whiteboard", key, { description, value })`)
- **persistentInstructions=true**: enables `"instructions"` store (e.g., `store_set("instructions", key, { content })`)
- **userInfo=true**: enables `"user_info"` store (e.g., `store_set("user_info", key, { value })`)
- **sharedWorkspace=true**: enables `"workspace"` store (e.g., `store_set("workspace", key, { summary, content })`)
- **memory=true**: adds six `memory_*` read tools and injects the configured user/profile view (these are not `store_*` tools)
- **memoryWrite=true**: adds six `memory_*` write tools and requires `memory=true`

TODO tools (`todo_add`, `todo_update`, `todo_remove`) remain separate and are registered when `userInfo=true`.

**Backward Compatibility:**

- Default features: `workingMemory: true`, `inContextMemory: true`, `persistentInstructions: false`, `sharedWorkspace: false`
- Code not using `features` config works unchanged

#### Conversation Management

AgentContextNextGen provides a simple API for managing conversation history:

```typescript
import { AgentContextNextGen } from '@everworker/oneringai';

const ctx = AgentContextNextGen.create({ model: 'gpt-4.1' });

// Add user message
ctx.addUserMessage('Hello!');

// Prepare for LLM call (handles compaction if needed)
const { input, budget } = await ctx.prepare();

// ... call LLM with input ...

// Add assistant response
ctx.addAssistantResponse(response.output);

// Add tool results
ctx.addToolResults([
  { tool_use_id: 'call_123', content: JSON.stringify({ result: 'success' }), state: ToolCallState.COMPLETED }
]);

// Get conversation history
const conversation = ctx.getConversation();

// Clear conversation
ctx.clearConversation('Starting fresh');
```

**Compaction:**

Compaction happens automatically during `prepare()` when context utilization exceeds the strategy threshold:

| Strategy | Threshold | Description |
|----------|-----------|-------------|
| `algorithmic` | 75% | Moves large tool results to Working Memory, limits tool pairs, applies rolling window (default) |

Custom strategies can be registered via `StrategyRegistry.register()`.

**Context Budget:**

```typescript
const { input, budget, compacted } = await ctx.prepare();

console.log(budget.utilizationPercent);  // Current usage %
console.log(budget.available);           // Remaining tokens
console.log(compacted);                  // true if compaction occurred
```

#### Session Persistence

AgentContextNextGen supports saving and loading sessions:

```typescript
import { AgentContextNextGen, createFileContextStorage } from '@everworker/oneringai';

// Create storage
const storage = createFileContextStorage('my-agent');

// Create context with storage
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { workingMemory: true },
  storage,
});

// Add messages and data
ctx.addUserMessage('Hello');

// Save session
await ctx.save('session-001', { title: 'My Session' });

// Later: Load session
const ctx2 = AgentContextNextGen.create({ model: 'gpt-4.1', storage });
await ctx2.load('session-001');
// ctx2 now has full conversation and plugin states restored
```

#### Plugin System (NextGen)

Extend AgentContextNextGen with custom plugins:

```typescript
import { IContextPluginNextGen, BasePluginNextGen, AgentContextNextGen } from '@everworker/oneringai';

// Create a custom plugin by extending BasePluginNextGen
class MyPlugin extends BasePluginNextGen {
  readonly name = 'my_plugin';

  private data: string[] = [];

  // Static usage instructions for the LLM (never compacted)
  getInstructions(): string | null {
    return null;
  }

  // Return content to be included in context (must update the token cache)
  async getContent(): Promise<string | null> {
    if (this.data.length === 0) return null;
    const content = `## My Plugin Data\n${this.data.join('\n')}`;
    this.updateTokenCache(this.estimator.estimateTokens(content));
    return content;
  }

  // Raw data for programmatic inspection
  getContents(): unknown {
    return this.data;
  }

  addData(item: string) {
    this.data.push(item);
    this.invalidateTokenCache();
  }

  // Opt in to compaction (base class defaults to false)
  isCompactable(): boolean {
    return this.data.length > 0;
  }

  // Compact: reduce content to fit within targetTokensToFree
  async compact(targetTokensToFree: number): Promise<number> {
    const before = this.getTokenSize();
    while (this.getTokenSize() > targetTokensToFree && this.data.length > 1) {
      this.data.shift();
      await this.getContent(); // refreshes the token cache
    }
    return before - this.getTokenSize();
  }

  // Serialize state for persistence
  getState(): unknown {
    return { data: this.data };
  }

  // Restore state
  restoreState(state: unknown): void {
    this.data = ((state as { data?: string[] }).data) || [];
    this.invalidateTokenCache();
  }
}

// Use the plugin
const ctx = AgentContextNextGen.create({ model: 'gpt-4.1' });
const plugin = new MyPlugin();
ctx.registerPlugin(plugin);
plugin.addData('Custom data');
```

#### Events

Monitor AgentContextNextGen activity:

```typescript
const ctx = AgentContextNextGen.create({ model: 'gpt-4.1' });

// Message events
ctx.on('message:added', ({ role }) => {
  console.log(`New ${role} message`);
});

// Compaction events
ctx.on('context:compacted', ({ tokensFreed }) => {
  console.log(`Freed ${tokensFreed} tokens`);
});

// Budget events
ctx.on('budget:warning', ({ budget }) => {
  console.log(`Context at ${budget.utilizationPercent.toFixed(1)}%`);
});

// Context prepared event
ctx.on('context:prepared', ({ budget }) => {
  console.log(`Context prepared: ${budget.totalUsed}/${budget.maxTokens} tokens`);
});
```

#### Accessing Context in Agent

Agent uses **AgentContextNextGen** with plugins for extended functionality:

```typescript
import { Agent, AgentContextNextGen, WorkingMemoryPluginNextGen } from '@everworker/oneringai';

// Create Agent with NextGen context
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [myTool],
  context: {
    features: { workingMemory: true, inContextMemory: true },
  },
});

// Access AgentContextNextGen directly
agent.context.addUserMessage('Hello');
const { input, budget } = await agent.context.prepare();
agent.context.addAssistantResponse(response);

// Get conversation
const conversation = agent.context.getConversation();  // Message[]

// Access WorkingMemory via plugin
const memoryPlugin = agent.context.getPlugin('working_memory') as WorkingMemoryPluginNextGen;
await memoryPlugin.store('key', 'description', value);

// Access tools via context
agent.context.tools.disable('tool_name');
```

**AgentContextNextGen API:**
```typescript
// AgentContextNextGen provides clean context management:
ctx.addUserMessage(content);              // Set current user input
ctx.addAssistantResponse(response);       // Add response to conversation
await ctx.prepare();                      // Prepare context for LLM call, returns { input, budget }
ctx.getConversation();                    // Get conversation history
ctx.registerPlugin(plugin);               // Register context plugin
ctx.getPlugin(name);                      // Get registered plugin by name
await ctx.consolidate();                  // Post-cycle consolidation (strategy-driven cleanup)
await ctx.save(sessionId);                // Save session (if storage configured)
await ctx.load(sessionId);                // Load session (if storage configured)

// Access ToolManager:
ctx.tools;                                // ToolManager instance
```

**NextGen Plugin System:**

Use NextGen plugins to extend AgentContextNextGen:

```typescript
import { BasePluginNextGen, WorkingMemoryPluginNextGen, InContextMemoryPluginNextGen } from '@everworker/oneringai';

// Built-in NextGen plugins:
// - WorkingMemoryPluginNextGen: Tiered memory (raw/summary/findings)
// - InContextMemoryPluginNextGen: Live key-value storage in context
// - PersistentInstructionsPluginNextGen: Disk-persisted instructions

// Custom plugin example:
class MyPlugin extends BasePluginNextGen {
  readonly name = 'my_plugin';

  getInstructions(): string | null {
    return null;
  }

  async getContent(): Promise<string | null> {
    const content = 'Custom context content';
    this.updateTokenCache(this.estimator.estimateTokens(content));
    return content;
  }

  getContents(): unknown {
    return null;
  }
}

ctx.registerPlugin(new MyPlugin());
```

---

### Why Context Management Matters

LLMs have fixed context windows (e.g., 128K tokens for GPT-4, 200K for Claude). As conversations grow, you must:
- **Track usage** to avoid hitting limits
- **Prioritize content** (instructions vs history vs memory)
- **Compact intelligently** when approaching limits
- **Preserve critical information** while freeing space

The context management system handles all of this automatically.

### Basic Context Management

Context management is **automatic** with AgentContextNextGen:

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [myTool],
  context: {
    strategy: 'algorithmic',  // Default: compact at 75% utilization
    features: { workingMemory: true },
  },
});

// AgentContextNextGen will automatically:
// 1. Track context usage across all plugins
// 2. Compact when approaching limits (at prepare() time)
// 3. Evict low-priority memory entries when needed
// 4. Call plugin compact() methods in priority order
// 5. Emit events for monitoring
```

### Architecture Overview

The context management system is built around **AgentContextNextGen** - the clean, plugin-first context manager:

```
┌─────────────────────────────────────────────────────┐
│               AgentContextNextGen                    │
│  - Plugin-first architecture                        │
│  - Clean message flow (addUserMessage → prepare)    │
│  - Single compaction point (right before LLM call)  │
└─────────────────┬───────────────────────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
┌─────────┐ ┌──────────┐ ┌───────────────┐
│ Strategy│ │ Plugins  │ │ Context       │
│ (when)  │ │ (what)   │ │ Structure     │
└─────────┘ └──────────┘ └───────────────┘

Strategy: Decides WHEN to compact (algorithmic: 75% threshold, or custom)
Plugins: WorkingMemoryPluginNextGen, InContextMemoryPluginNextGen, etc.
Context: Developer Message → Conversation History → Current Input
```

### Manual Context Management

For advanced use cases, use **AgentContextNextGen** with plugins:

```typescript
import {
  AgentContextNextGen,
  WorkingMemoryPluginNextGen,
  InContextMemoryPluginNextGen,
} from '@everworker/oneringai';

// Create AgentContextNextGen with configuration
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  systemPrompt: 'Your system instructions',
  maxContextTokens: 128000,    // Model's context window
  responseReserve: 4096,       // Reserve tokens for response
  strategy: 'algorithmic',     // Default compaction strategy (75% threshold)
  features: {
    workingMemory: true,       // Enable WorkingMemoryPluginNextGen
    inContextMemory: true,     // Enable InContextMemoryPluginNextGen
  },
});

// Plugins are auto-registered when features are enabled
// Access them via getPlugin():
const memoryPlugin = ctx.getPlugin('working_memory') as WorkingMemoryPluginNextGen;
const inContextPlugin = ctx.getPlugin('in_context_memory') as InContextMemoryPluginNextGen;

// Add user message (sets _currentInput)
ctx.addUserMessage('Current task description');

// Prepare context before each LLM call
const { input, budget } = await ctx.prepare();
console.log(`Context: ${budget.totalUsed}/${budget.maxTokens} tokens`);
console.log(`Utilization: ${budget.utilizationPercent.toFixed(1)}%`);

// After LLM response, add it to conversation
ctx.addAssistantResponse(llmResponse);

// Get conversation history
const conversation = ctx.getConversation();  // Message[]
```

### Compactors Deep Dive

> **Note:** `TruncateCompactor`, `MemoryEvictionCompactor`, and `SummarizeCompactor` implement the legacy `IContextCompactor`/`IContextComponent` interfaces (`src/core/context/types.ts`) and are standalone utility classes — `AgentContextNextGen` never uses them. Its actual compaction is driven entirely by `ICompactionStrategy` implementations (e.g. `AlgorithmicCompactionStrategy`), which contain no reference to these compactor classes.

Compactors determine **how** content is reduced during compaction. Each compactor handles components with a matching `strategy` metadata.

#### Available Compactors

| Compactor | Strategy | Priority | What It Does |
|-----------|----------|----------|--------------|
| **TruncateCompactor** | `truncate` | 10 | Removes content from the end |
| **MemoryEvictionCompactor** | `evict` | 8 | Evicts low-priority memory entries |
| **SummarizeCompactor** | `summarize` | 5 | Uses LLM to create intelligent summaries |

**Lower priority number = runs earlier** (summarize before truncate).

#### SummarizeCompactor (LLM-Based)

The `SummarizeCompactor` uses an LLM to intelligently summarize content, preserving key information while reducing token count.

```typescript
import { SummarizeCompactor, ApproximateTokenEstimator } from '@everworker/oneringai';

const estimator = new ApproximateTokenEstimator();

// Create summarize compactor with LLM
const summarizeCompactor = new SummarizeCompactor(estimator, {
  textProvider: myTextProvider,     // Required: LLM for summarization
  model: 'gpt-4o-mini',             // Optional: model to use (default: same as agent)
  maxSummaryTokens: 500,            // Optional: max tokens for summary
  preserveStructure: true,          // Optional: keep headings/lists (default: true)
  fallbackToTruncate: true,         // Optional: truncate if LLM fails (default: true)
});

// Components with strategy: 'summarize' will use this compactor
const component = {
  name: 'conversation_history',
  content: longConversation,
  priority: 6,
  compactable: true,
  metadata: { strategy: 'summarize' },  // Uses SummarizeCompactor
};
```

**What SummarizeCompactor Preserves:**

For **conversation history**:
- Key decisions made
- Important facts discovered
- User preferences expressed
- Unresolved questions

For **tool outputs** (search/scrape results):
- Key findings relevant to the task
- Source URLs and main points
- Factual data (numbers, dates, names)
- Contradictions between sources

```typescript
// Example: Research task with summarization
// AgentContextNextGen is the unified context manager - configure via Agent.create()
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    features: { workingMemory: true },
  },
});

// Access context management via agent.context (AgentContextNextGen instance)
const { budget } = await agent.context.prepare();
```

#### MemoryEvictionCompactor

Evicts low-priority memory entries based on the `avgEntrySize` metadata.

```typescript
import { MemoryEvictionCompactor } from '@everworker/oneringai';

const evictionCompactor = new MemoryEvictionCompactor(estimator);

// Components with strategy: 'evict' will use this compactor
const memoryComponent = {
  name: 'memory_index',
  content: memoryIndex,
  priority: 8,
  compactable: true,
  metadata: {
    strategy: 'evict',
    avgEntrySize: 100,                    // Average tokens per entry
    evict: async (count) => { await evictMemoryEntries(count); },
    getUpdatedContent: async () => getMemoryIndex(),
  },
};
```

### Pre-Compaction Hooks

The `beforeCompaction` lifecycle hook allows agents to save important data before compaction occurs. This is critical for research tasks where tool outputs may contain valuable information.

```typescript
import { Agent } from '@everworker/oneringai';
// Note: the `BeforeCompactionContext` type shown below is defined internally
// (src/core/BaseAgent.ts) and is not currently re-exported from the package root —
// inline-type your handler's parameter or mirror the shape shown below until it is exported.

// Define lifecycle hooks when creating the agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  lifecycleHooks: {
    beforeCompaction: async (context: BeforeCompactionContext) => {
      console.log(`Agent ${context.agentId}: Compaction starting`);
      console.log(`Current usage: ${context.currentBudget.used}/${context.currentBudget.total}`);
      console.log(`Need to free: ${context.estimatedTokensToFree} tokens`);
      console.log(`Strategy: ${context.strategy}`);
      console.log(`Components to compact: ${context.components.length}`);

      // Example: Save important tool outputs before they're compacted
      for (const component of context.components) {
        if (component.name === 'tool_outputs' && component.compactable) {
          // Extract key findings and save to memory
          await saveKeyFindings(component.content);
        }
      }
    },
  },
});

// AgentContextNextGen handles all context management internally
// No separate ContextManager needed
```

#### BeforeCompactionContext

The hook receives detailed context about the upcoming compaction:

```typescript
interface BeforeCompactionContext {
  /** Agent identifier */
  agentId: string;

  /** Current context budget info (a lightweight summary, not the full ContextBudget) */
  currentBudget: {
    total: number;
    used: number;
    available: number;
    utilizationPercent: number;
    status: 'ok' | 'warning' | 'critical';
  };

  /** Strategy being used (e.g. 'algorithmic') */
  strategy: string;

  /** Components about to be compacted (read-only summaries) */
  components: ReadonlyArray<{
    name: string;
    priority: number;
    compactable: boolean;
  }>;

  /** Estimated tokens that need to be freed */
  estimatedTokensToFree: number;
}
```

#### Error Handling in Hooks

Hooks are designed to be resilient - errors are logged but don't prevent compaction:

```typescript
const hooks = {
  beforeCompaction: async (context) => {
    // Even if this throws, compaction will continue
    throw new Error('Hook error');
  },
};

// Compaction proceeds, error is logged to console
```

### Context Strategies Deep Dive

AgentContextNextGen uses a **strategy-based compaction system** with the `ICompactionStrategy` interface. The strategy controls when and how context is compacted.

#### Built-in Strategies

| Strategy | Threshold | Description |
|----------|-----------|-------------|
| **algorithmic** (default) | 75% | Moves large tool results to Working Memory, limits tool pairs to 10, applies rolling window. Best for tool-heavy agents. |

The `algorithmic` strategy is the recommended default. It requires the `working_memory` plugin to be enabled (which it is by default).

```typescript
// Default - uses algorithmic strategy automatically
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: { features: { workingMemory: true } },
});

// Explicit strategy selection
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: { strategy: 'algorithmic' },
});
```

---

### Creating Custom Strategies

For specialized use cases, implement `ICompactionStrategy` and register it via `StrategyRegistry`:

```typescript
import {
  ICompactionStrategy,
  CompactionContext,
  CompactionResult,
  ConsolidationResult,
  StrategyRegistry,
  Agent,
} from '@everworker/oneringai';

// Implement the ICompactionStrategy interface
class TimeBasedStrategy implements ICompactionStrategy {
  readonly name = 'time-based';
  readonly displayName = 'Time-Based';
  readonly description = 'Adjusts compaction threshold based on time of day';

  get threshold(): number {
    const hour = new Date().getHours();
    const isBusinessHours = hour >= 9 && hour <= 17;
    return isBusinessHours ? 0.60 : 0.85;
  }

  async compact(context: CompactionContext, targetToFree: number): Promise<CompactionResult> {
    const log: string[] = [];

    // Remove old messages from conversation
    const messages = context.conversation;
    const toRemove = Math.floor(messages.length * 0.3);
    const indices = Array.from({ length: toRemove }, (_, i) => i);
    const tokensFreed = await context.removeMessages(indices);

    log.push(`Time-based: removed ${toRemove} old messages`);
    return { tokensFreed, messagesRemoved: indices.length, pluginsCompacted: [], log };
  }

  async consolidate(context: CompactionContext): Promise<ConsolidationResult> {
    // Post-cycle cleanup (optional)
    return { performed: false, tokensChanged: 0, actions: [] };
  }
}

// Register the custom strategy
StrategyRegistry.register(TimeBasedStrategy);

// Use your custom strategy via Agent.create()
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    strategy: 'time-based',  // Uses your registered strategy
  },
});

// Or provide a strategy instance directly
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    compactionStrategy: new TimeBasedStrategy(),
  },
});
```

### Using Strategies

```typescript
// Default - algorithmic strategy (recommended for most use cases)
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  // strategy defaults to 'algorithmic' (75% threshold)
});

// Custom registered strategy
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: { strategy: 'time-based' },  // Your registered strategy
});
```

### Token Estimation

The `ApproximateTokenEstimator` provides content-type-aware estimation:

```typescript
import { ApproximateTokenEstimator } from '@everworker/oneringai';

const estimator = new ApproximateTokenEstimator();

// Basic estimation (mixed content assumed)
const tokens1 = estimator.estimateTokens('Hello, world!');

// Content-type-aware estimation for better accuracy
const codeTokens = estimator.estimateTokens(sourceCode, 'code');    // ~3 chars/token
const proseTokens = estimator.estimateTokens(essay, 'prose');       // ~4 chars/token
const mixedTokens = estimator.estimateTokens(readme, 'mixed');      // ~3.5 chars/token

// Estimate structured data
const dataTokens = estimator.estimateDataTokens({ users: [], config: {} });
```

**Why content type matters:**
- Code has more special characters and shorter words → fewer chars/token
- Prose has longer words and punctuation → more chars/token
- Accurate estimation prevents over/under-compaction

### Context Budget Monitoring

```typescript
// Get budget from prepare() call
const { input, budget, compacted } = await agent.context.prepare();

console.log(`Max tokens: ${budget.maxTokens}`);
console.log(`Used tokens: ${budget.totalUsed}`);
console.log(`Available: ${budget.available}`);
console.log(`Utilization: ${budget.utilizationPercent.toFixed(1)}%`);

// Check if compaction occurred
if (compacted) {
  console.log('Context was compacted to make room');
}

// Detailed breakdown
console.log('Breakdown:');
console.log(`  System prompt: ${budget.breakdown.systemPrompt} tokens`);
console.log(`  Plugin instructions: ${budget.breakdown.pluginInstructions} tokens`);
console.log(`  Conversation: ${budget.breakdown.conversation} tokens`);
console.log(`  Current input: ${budget.breakdown.currentInput} tokens`);
```

### Agent Lifecycle Hooks for Context

Use lifecycle hooks to integrate context management with your application. **Caveat:** in the current `Agent` implementation, only `beforeCompaction` is actually invoked at runtime (wired in `Agent`'s constructor via `AgentContextNextGen.setBeforeCompactionCallback`). `beforeContextPrepare`, `afterCompaction`, `beforeToolExecution`, `afterToolExecution`, and `onError` can be registered via `agent.setLifecycleHooks()`, but no code path in `Agent`/`BaseAgent` currently calls their `invoke*` helpers, so they will not fire.

```typescript
import type { AgentConfig } from '@everworker/oneringai';

type LifecycleHooks = NonNullable<AgentConfig['lifecycleHooks']>;

const hooks: LifecycleHooks = {
  // This is the lifecycle hook currently wired by Agent.
  beforeCompaction: async (context) => {
    await monitoring.record({
      event: 'context_compaction_starting',
      agentId: context.agentId,
      utilizationPercent: context.currentBudget.utilizationPercent,
      strategy: context.strategy,
      estimatedTokensToFree: context.estimatedTokensToFree,
    });
  },
};

// Apply hooks to agent
agent.setLifecycleHooks(hooks);
```

### Best Practices for Context Management

#### 1. Use the Default Strategy

The `algorithmic` strategy (default, 75% threshold) works well for most use cases. It automatically offloads large tool results to Working Memory and manages conversation history:

```typescript
import { Agent } from '@everworker/oneringai';

// Default algorithmic strategy - recommended for most use cases
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: { features: { workingMemory: true } },
});

// For custom compaction behavior, register a custom strategy via StrategyRegistry
```

#### 2. Monitor in Production

```typescript
// Set up monitoring with AgentContextNextGen events
const ctx = agent.context;

ctx.on('context:compacted', async ({ tokensFreed }) => {
  await metrics.gauge('context.tokens_freed', tokensFreed);
});

ctx.on('context:prepared', async ({ budget }) => {
  await metrics.gauge('context.usage', budget.totalUsed);
  await metrics.gauge('context.total', budget.maxTokens);
});

ctx.on('budget:warning', async ({ budget }) => {
  const utilization = Math.round(budget.utilizationPercent);
  await alerts.warn(`Context warning: ${utilization}%`);
});
```

#### 3. Use WorkingMemory Tiers

```typescript
// Store data in appropriate tiers based on importance
const memoryPlugin = ctx.getPlugin('working_memory') as WorkingMemoryPluginNextGen;

// Raw tier: Large, unprocessed data (evicted first)
await memoryPlugin.store('search.results', 'Raw search results', largeResults, { tier: 'raw' });

// Summary tier: Condensed information
await memoryPlugin.store('search.summary', 'Search summary', summaryData, { tier: 'summary' });

// Findings tier: Key insights (evicted last)
await memoryPlugin.store('search.findings', 'Key findings', findings, { tier: 'findings' });
```

#### 4. Plan for Compaction

```typescript
// Structure data for efficient compaction using tiers
const memoryPlugin = ctx.getPlugin('working_memory') as WorkingMemoryPluginNextGen;

// BAD: Single large object in findings (won't be evicted easily)
await memoryPlugin.store('all.data', 'All data', hugeObject, { tier: 'findings' });

// GOOD: Split by importance using tiers
// Raw tier: Evicted first during compaction
await memoryPlugin.store('data.raw', 'Raw data', rawData, { tier: 'raw' });

// Summary tier: Evicted second
await memoryPlugin.store('data.summary', 'Summarized data', summaryData, { tier: 'summary' });

// Findings tier: Evicted last (most important)
await memoryPlugin.store('data.findings', 'Key findings', findings, { tier: 'findings' });
```

---

## Unified Store Tools

In v0.5.0, the 19 plugin-specific CRUD tools (`memory_store`, `context_set`, `instructions_set`, `user_info_set`, etc.) were replaced with **5 generic `store_*` tools** that work across all stores. This reduces tool clutter, simplifies the LLM's decision-making, and makes it trivial to add new stores.

### The 5 Generic Tools

| Tool | Signature | Description |
|------|-----------|-------------|
| `store_get` | `store_get(store, key?)` | Get one entry by key, or all entries when key is omitted |
| `store_set` | `store_set(store, key, data)` | Create or update an entry |
| `store_delete` | `store_delete(store, key)` | Remove an entry by key |
| `store_list` | `store_list(store, filter?)` | List entries with optional filters |
| `store_action` | `store_action(store, action, params?)` | Store-specific operations (query, clear, etc.) |

The `store` parameter is a string identifying which store to target. The `data` parameter is an object whose shape depends on the store.

### Available Stores

| Store | Feature Flag | Description | Data Shape for `store_set` |
|-------|-------------|-------------|---------------------------|
| `"notes"` | `workingMemory: true` | Tiered working memory (raw/summary/findings) | `{ description, value, tier?, priority? }` |
| `"whiteboard"` | `inContextMemory: true` | Key-value pairs visible directly in LLM context | `{ description, value, priority? }` (`showInUI` is host-owned metadata; see below) |
| `"instructions"` | `persistentInstructions: true` | Agent instructions persisted to disk | `{ content }` |
| `"user_info"` | `userInfo: true` | User-scoped preferences across agents | `{ value, description? }` |
| `"workspace"` | `sharedWorkspace: true` | Multi-agent coordination workspace | `{ summary, content?, references?, status?, tags? }` |

### When to Use Each Store

| Need | Store | Why |
|------|-------|-----|
| Large data, external retrieval | `"notes"` | Index in context, full data via `store_get` |
| Small live state, instant access | `"whiteboard"` | Full values rendered directly in context |
| Cross-session agent rules | `"instructions"` | Persists to disk, auto-loaded on start |
| User preferences shared across agents | `"user_info"` | User-scoped, not agent-scoped |
| Multi-agent data sharing | `"workspace"` | Versioned entries with author tracking |

### Migration from Old Tool Names

| Old Tool | New Equivalent |
|----------|---------------|
| `memory_store(key, desc, value, ...)` | `store_set("notes", key, { description, value, tier?, ... })` |
| `memory_retrieve(key)` | `store_get("notes", key)` |
| `memory_delete(key)` | `store_delete("notes", key)` |
| `memory_query(...)` | `store_action("notes", "query", { pattern?, tier?, ... })` |
| `memory_cleanup_raw()` | `store_action("notes", "cleanup_raw")` |
| `context_set(key, desc, value, ...)` | `store_set("whiteboard", key, { description, value, priority? })` |
| `context_delete(key)` | `store_delete("whiteboard", key)` |
| `context_list()` | `store_list("whiteboard")` |
| `instructions_set(key, content)` | `store_set("instructions", key, { content })` |
| `instructions_remove(key)` | `store_delete("instructions", key)` |
| `instructions_list()` | `store_list("instructions")` |
| `instructions_clear(confirm)` | `store_action("instructions", "clear", { confirm: true })` |
| `user_info_set(key, value, desc?)` | `store_set("user_info", key, { value, description? })` |
| `user_info_get(key?)` | `store_get("user_info", key?)` |
| `user_info_remove(key)` | `store_delete("user_info", key)` |
| `user_info_clear(confirm)` | `store_action("user_info", "clear", { confirm: true })` |

> **Note:** TODO tools (`todo_add`, `todo_update`, `todo_remove`) are unchanged.

### Example Usage by Store

#### Memory Store

```jsonc
// Store data in working memory
// Tool call from LLM:
{
  "name": "store_set",
  "arguments": {
    "store": "notes",
    "key": "api_response",
    "data": {
      "description": "Full API response from /users endpoint",
      "value": { "users": ["Alice", "Bob", "Charlie"] },
      "tier": "findings",
      "priority": "high"
    }
  }
}

// Retrieve data
{
  "name": "store_get",
  "arguments": {
    "store": "notes",
    "key": "api_response"
  }
}

// Query memory entries
{
  "name": "store_action",
  "arguments": {
    "store": "notes",
    "action": "query",
    "params": { "tier": "findings", "pattern": "api_*" }
  }
}

// Clean up raw tier
{
  "name": "store_action",
  "arguments": {
    "store": "notes",
    "action": "cleanup_raw"
  }
}
```

#### Context Store

```jsonc
// Store live state visible directly in context
{
  "name": "store_set",
  "arguments": {
    "store": "whiteboard",
    "key": "current_state",
    "data": {
      "description": "Processing state for current task",
      "value": { "step": 3, "status": "active" },
      "priority": "high"
    }
  }
}

// Delete an entry
{
  "name": "store_delete",
  "arguments": {
    "store": "whiteboard",
    "key": "temp_data"
  }
}

// List all entries
{
  "name": "store_list",
  "arguments": {
    "store": "whiteboard"
  }
}
```

#### Instructions Store

```jsonc
// Set a persistent instruction
{
  "name": "store_set",
  "arguments": {
    "store": "instructions",
    "key": "personality",
    "data": {
      "content": "Always be friendly and helpful. Use clear, simple language."
    }
  }
}

// Remove an instruction
{
  "name": "store_delete",
  "arguments": {
    "store": "instructions",
    "key": "personality"
  }
}

// Clear all instructions
{
  "name": "store_action",
  "arguments": {
    "store": "instructions",
    "action": "clear",
    "params": { "confirm": true }
  }
}
```

#### User Info Store

```jsonc
// Store user preference
{
  "name": "store_set",
  "arguments": {
    "store": "user_info",
    "key": "theme",
    "data": {
      "value": "dark",
      "description": "User preferred theme"
    }
  }
}

// Get all user info
{
  "name": "store_get",
  "arguments": {
    "store": "user_info"
  }
}

// Clear all user info
{
  "name": "store_action",
  "arguments": {
    "store": "user_info",
    "action": "clear",
    "params": { "confirm": true }
  }
}
```

### Creating a Custom Store Plugin

Any plugin that implements `IContextPluginNextGen` and `IStoreHandler` automatically becomes available as a store target. The `IStoreHandler` interface defines the CRUD operations:

```typescript
import {
  BasePluginNextGen,
  IStoreHandler,
  StoreEntrySchema,
  StoreGetResult,
  StoreSetResult,
  StoreDeleteResult,
  StoreListResult,
  StoreActionResult,
} from '@everworker/oneringai';

class SnippetsPlugin extends BasePluginNextGen implements IStoreHandler {
  readonly name = 'snippets';

  private snippets = new Map<string, { text: string; createdAt: number }>();

  getStoreSchema(): StoreEntrySchema {
    return {
      storeId: 'snippets',
      displayName: 'Snippets',
      description: 'Text snippets keyed by name',
      usageHint: 'Use for: quick reusable text snippets.',
      setDataFields: 'text (required): Snippet content',
    };
  }

  // IStoreHandler implementation
  async storeGet(key?: string): Promise<StoreGetResult> {
    if (key) {
      const snippet = this.snippets.get(key);
      return snippet ? { found: true, key, entry: snippet } : { found: false, key };
    }
    // Return all entries when key is omitted
    const entries = Array.from(this.snippets.entries()).map(([k, v]) => ({ key: k, ...v }));
    return { found: true, entries };
  }

  async storeSet(key: string, data: Record<string, unknown>): Promise<StoreSetResult> {
    const text = data.text as string;
    if (!text) return { success: false, key, error: 'Missing "text" field' };
    this.snippets.set(key, { text, createdAt: Date.now() });
    return { success: true, key, message: `Snippet "${key}" saved` };
  }

  async storeDelete(key: string): Promise<StoreDeleteResult> {
    const deleted = this.snippets.delete(key);
    return { deleted, key };
  }

  async storeList(filter?: Record<string, unknown>): Promise<StoreListResult> {
    const entries = Array.from(this.snippets.entries()).map(([k, v]) => ({
      key: k,
      text: v.text,
      createdAt: v.createdAt,
    }));
    return { entries, total: entries.length };
  }

  async storeAction(action: string, params?: Record<string, unknown>): Promise<StoreActionResult> {
    if (action === 'clear') {
      if (!params?.confirm) return { success: false, action, error: 'Requires confirm: true' };
      this.snippets.clear();
      return { success: true, action, message: 'All snippets cleared' };
    }
    return { success: false, action, error: `Unknown action: ${action}` };
  }

  // Standard plugin methods
  getInstructions(): string | null { return 'Use store_set("snippets", key, { text }) to save text snippets.'; }
  async getContent(): Promise<string | null> { return null; }
  getContents(): unknown { return Object.fromEntries(this.snippets); }
  getTools() { return []; }  // No plugin-specific tools needed; store_* tools handle everything
}
```

Register and use:

```typescript
const ctx = AgentContextNextGen.create({ model: 'gpt-4.1' });
ctx.registerPlugin(new SnippetsPlugin());

// Now the LLM can use:
// store_set("snippets", "meeting", { text: "Discussed Q3 roadmap" })
// store_get("snippets", "meeting")
// store_list("snippets")
// store_action("snippets", "clear", { confirm: true })
```

---

## Shared Workspace

The **Shared Workspace** store enables multi-agent coordination by providing a shared, versioned key-value space that multiple agents can read from and write to.

### Setup

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    features: { sharedWorkspace: true },
  },
});
```

### Entry Model

Each workspace entry has richer metadata than other stores:

```typescript
interface WorkspaceEntry {
  key: string;
  content?: string;           // Inline text content (for collaborative documents)
  references?: string[];      // External pointers: file paths, DB IDs, URLs
  summary: string;            // Human-readable summary (always required)
  status?: string;            // e.g., "draft", "final", "in-review"
  author?: string;            // Agent or user who wrote it
  version: number;            // Auto-incremented on each update
  tags?: string[];            // Categorization tags
  createdAt: number;
  updatedAt: number;
}
```

### Usage

```jsonc
// Store a workspace entry
{
  "name": "store_set",
  "arguments": {
    "store": "workspace",
    "key": "research_findings",
    "data": {
      "summary": "Analysis of competitor pricing models",
      "content": "Competitors: ...\nInsights: ...",
      "status": "draft",
      "tags": ["research", "pricing"],
      "references": ["market_data"]
    }
  }
}

// Get a specific entry
{
  "name": "store_get",
  "arguments": {
    "store": "workspace",
    "key": "research_findings"
  }
}

// List entries (with optional filter)
{
  "name": "store_list",
  "arguments": {
    "store": "workspace",
    "filter": { "tags": ["research"], "status": "draft" }
  }
}
```

### Workspace-Specific Actions

The workspace store supports additional actions via `store_action`:

| Action | Params | Description |
|--------|--------|-------------|
| `log` | `{ message, author? }` | Append a log entry (for coordination/debugging) |
| `history` | `{ limit? }` | Get recent entries from the shared team log (default limit: 20) |
| `archive` | `{ key }` | Archive an entry (soft-delete) |
| `clear` | `{ confirm: true }` | Clear all entries |

```jsonc
// Log a coordination message
{
  "name": "store_action",
  "arguments": {
    "store": "workspace",
    "action": "log",
    "params": { "message": "Starting phase 2 of analysis", "author": "researcher" }
  }
}

// Get recent team log entries
{
  "name": "store_action",
  "arguments": {
    "store": "workspace",
    "action": "history",
    "params": { "limit": 20 }
  }
}
```

### Multi-Agent Example

```typescript
import { Agent, Connector, Vendor } from '@everworker/oneringai';

Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Two agents share the same workspace via shared storage
const researcher = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  instructions: 'You are a research agent. Store findings in the workspace.',
  context: { features: { sharedWorkspace: true } },
});

const writer = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  instructions: 'You are a writing agent. Read findings from workspace and write reports.',
  context: { features: { sharedWorkspace: true } },
});

// Researcher stores findings
await researcher.run('Research AI trends for 2026');
// Agent calls: store_set("workspace", "ai_trends", { summary: "Key AI trends...", content: {...} })

// Writer reads findings and writes report
await writer.run('Write a report based on the workspace findings');
// Agent calls: store_get("workspace", "ai_trends"), then produces a report
```

---

## InContextMemory (NextGen Plugin)

**InContextMemoryPluginNextGen** is a context plugin that stores key-value pairs **directly in the LLM context** (not just an index like WorkingMemory). This is ideal for small, frequently-updated state that the LLM needs instant access to without retrieval calls.

### Key Difference from WorkingMemory

| Feature | WorkingMemory | InContextMemory |
|---------|---------------|-----------------|
| **Storage** | External (in-memory or file) | Directly in LLM context |
| **Context visibility** | Index only (keys + descriptions) | Full values visible |
| **Access pattern** | Requires `store_get("notes", key)` call | Immediate - no retrieval needed |
| **UI integration** | Host-defined | `showInUI` metadata and `onEntriesChanged` are available to hosts; core renders no UI |
| **Best for** | Large data, rarely accessed info | Small state, frequently updated, live dashboards |
| **Default capacity** | 25MB | 20 entries, 40000 tokens |

### Quick Setup

```typescript
import { AgentContextNextGen, InContextMemoryPluginNextGen } from '@everworker/oneringai';

const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { inContextMemory: true },  // Enables InContextMemoryPluginNextGen
});

// Plugin is automatically registered when feature is enabled
// Access it via the plugin registry
const plugin = ctx.getPlugin('in_context_memory') as InContextMemoryPluginNextGen;
plugin.set('state', 'Current processing state', { step: 1, status: 'active' });
```

### Manual Setup

For more control, you can set up the plugin manually:

```typescript
import { AgentContextNextGen, InContextMemoryPluginNextGen } from '@everworker/oneringai';

const ctx = AgentContextNextGen.create({ model: 'gpt-4.1' });

// Create and configure plugin
const plugin = new InContextMemoryPluginNextGen({
  maxEntries: 20,
  maxTotalTokens: 40000,
  defaultPriority: 'normal',
  showTimestamps: false,
});

// Register plugin with context
ctx.registerPlugin(plugin);
```

### Configuration Options

```typescript
interface InContextMemoryConfig {
  /** Maximum number of entries (default: 20) */
  maxEntries?: number;

  /** Maximum total tokens for all entries (default: 40000) */
  maxTotalTokens?: number;

  /** Default priority for new entries (default: 'normal') */
  defaultPriority?: 'low' | 'normal' | 'high' | 'critical';

  /** Whether to show timestamps in output (default: false) */
  showTimestamps?: boolean;

  /** Callback fired when entries change (set/delete/clear/restore). Debounced at 100ms. */
  onEntriesChanged?: (entries: InContextEntry[]) => void;
}
```

### Available Tools

The LLM manages in-context memory through the unified `store_*` tools with `store="whiteboard"` (values are always visible directly in context, so no `store_get` is needed):

#### store_set("whiteboard", ...)

Store or update a key-value pair in the live context:

```jsonc
// Tool call from LLM
{
  "name": "store_set",
  "arguments": {
    "store": "whiteboard",
    "key": "current_state",
    "data": {
      "description": "Processing state for current task",
      "value": { "step": 3, "status": "active", "errors": [] },
      "priority": "high"     // optional: low, normal, high, critical
    }
  }
}
```

#### store_delete("whiteboard", ...)

Remove an entry to free space:

```jsonc
// Tool call from LLM
{
  "name": "store_delete",
  "arguments": {
    "store": "whiteboard",
    "key": "temp_data"
  }
}
// Returns: { "deleted": true, "key": "temp_data" }
```

#### store_list("whiteboard")

List all entries with metadata:

```jsonc
// Tool call from LLM
{
  "name": "store_list",
  "arguments": {
    "store": "whiteboard"
  }
}
// Returns: {
//   "entries": [
//     { "key": "current_state", "description": "...", "priority": "high", "showInUI": true, "updatedAt": 1769798400000 },
//     { "key": "user_prefs", "description": "...", "priority": "normal", "showInUI": false, "updatedAt": 1769798400000 }
//   ],
//   "total": 2
// }
```

### Direct API Access

The plugin provides a programmatic API for direct manipulation:

```typescript
const plugin = ctx.getPlugin('in_context_memory') as InContextMemoryPluginNextGen;

// Store entries
plugin.set('state', 'Current state', { step: 1 });
plugin.set('prefs', 'User preferences', { verbose: true }, 'high');
plugin.set('temp', 'Temporary data', 'xyz', 'low');

// Store with UI display (5th argument)
plugin.set('dashboard', 'Live dashboard', '## Status\n- OK', 'normal', true);

// Retrieve
const state = plugin.get('state');        // { step: 1 }
const missing = plugin.get('nonexistent'); // undefined

// Check existence
plugin.has('state');  // true
plugin.has('missing'); // false

// Delete
plugin.delete('temp');  // true (existed and deleted)
plugin.delete('missing'); // false (didn't exist)

// List all entries
const entries = plugin.list();
// [{ key: 'state', description: '...', priority: 'normal', showInUI: false, updatedAt: 1706... }, ...]

// Get entry count
console.log(plugin.list().length);  // 2

// Clear all
plugin.clear();
```

### Priority-Based Eviction

When space is needed (either due to `maxEntries` or `compact()` being called), entries are evicted in this order:

1. **Priority**: `low` → `normal` → `high` (lowest first)
2. **Age**: Within the same priority, oldest entries (by `updatedAt`) are evicted first
3. **Critical**: Entries with `priority: 'critical'` are **never** auto-evicted

```typescript
// Example: limited to 3 entries
const plugin = new InContextMemoryPluginNextGen({ maxEntries: 3 });
ctx.registerPlugin(plugin);

plugin.set('critical1', 'Critical data', 'value', 'critical');
plugin.set('high1', 'High priority', 'value', 'high');
plugin.set('normal1', 'Normal data', 'value', 'normal');
plugin.set('low1', 'Low priority', 'value', 'low');  // Triggers eviction

// 'normal1' is evicted (lowest priority among non-critical)
console.log(plugin.has('critical1')); // true
console.log(plugin.has('high1'));     // true
console.log(plugin.has('low1'));      // true (just added)
console.log(plugin.has('normal1'));   // false (evicted)
```

### Context Output Format

When the LLM context is prepared, InContextMemory adds a formatted section titled after the store's display name ("Whiteboard"):

```markdown
# Whiteboard

**current_state** (high): Processing state for current task
{
  "step": 3,
  "status": "active",
  "errors": []
}

**user_preferences** (normal): User preferences for this session
{
  "theme": "dark",
  "verbose": true
}
```

Each entry renders as `**key** (priority): description` followed by a plain fenced, pretty-printed JSON block. The LLM can read this section directly without making any tool calls.

### UI Display (`showInUI`)

Each InContextMemory entry can carry optional `showInUI` metadata. OneRingAI stores, serializes, and returns the flag, but it does not render a sidebar or define pinning behavior. Those are host-application responsibilities.

The built-in whiteboard schema intentionally does **not** advertise `showInUI` to the LLM. The `store_set` handler still accepts it for compatibility, but an agent will only know to send the field when a host plugin or application instruction explicitly teaches that extension (for example, a UI integration layer). The direct `set()` API always supports it.

#### How It Works

1. **Host code sets `showInUI: true`** through the direct `set()` API, or explicitly extends the LLM's instructions/schema to permit the field.
2. **Host app receives updates** via the `onEntriesChanged` callback (debounced at 100ms).
3. **Host code chooses rendering, sanitization, pinning, and persistence behavior.**

#### Via `store_set` in a host-enabled UI integration

```jsonc
// This field is accepted by the handler, but the default LLM-facing store
// schema does not advertise it. Expose it deliberately in host instructions.
{
  "name": "store_set",
  "arguments": {
    "store": "whiteboard",
    "key": "progress",
    "data": {
      "description": "Task progress dashboard",
      "value": "## Research Progress\n\n| Topic | Status |\n|-------|--------|\n| API Design | Done |\n| Implementation | In Progress |\n\n**Next:** Write tests",
      "priority": "high",
      "showInUI": true
    }
  }
}
```

#### Via Direct API

```typescript
// Show a progress dashboard in the UI
plugin.set(
  'progress',
  'Task progress',
  '## Progress\n- [x] Step 1: Research\n- [x] Step 2: Design\n- [ ] Step 3: Implement',
  'high',
  true  // showInUI
);

// Update it later (showInUI persists with the entry)
plugin.set('progress', 'Task progress',
  '## Progress\n- [x] Step 1\n- [x] Step 2\n- [x] Step 3: Implement',
  'high',
  true
);

// Hide from UI
plugin.set('progress', 'Task progress', value, 'high', false);
```

#### Real-Time Updates with `onEntriesChanged`

Host applications can subscribe to entry changes to update their UI in real time:

```typescript
const plugin = new InContextMemoryPluginNextGen({
  maxEntries: 20,
  onEntriesChanged: (entries) => {
    // Called whenever entries are set, deleted, cleared, or restored
    // Debounced at 100ms to avoid excessive updates during batch operations
    const visibleEntries = entries.filter(e => e.showInUI);
    updateSidebarUI(visibleEntries);
  },
});
```

The callback fires on: `set()`, `delete()`, `clear()`, `restoreState()`, and `compact()`.

#### User Pinning

Host applications can let users **pin** specific entries regardless of the entry's `showInUI` value. This is useful when:

- An agent stores useful state but doesn't mark it as `showInUI`
- The user wants to monitor a specific key during a session
- The agent sets `showInUI: false` on an entry the user still wants to see

Pin persistence belongs to the host application. A host can store the selected keys per agent so they survive application restarts; OneRingAI supplies the entry data and change callback, not a UI-specific persistence layer.

#### Rendering

Rendering is not part of OneRingAI. A host may pass string values through its
normal Markdown renderer and support features such as:

- **Code blocks** with syntax highlighting
- **Tables** with alignment
- **LaTeX math** (`$inline$` and `$$block$$`)
- **Mermaid diagrams** (flowcharts, sequence diagrams, etc.)
- **Vega-Lite charts** (bar, line, pie, etc.)
- **Markmap mindmaps**
- **Checklists**, **blockquotes**, **images**, and more

Within the LLM context, objects and arrays are serialized as formatted JSON code blocks. A host UI decides independently how to render every value and must apply its own sanitization policy.

### Session Persistence

InContextMemoryPluginNextGen supports full state serialization for session persistence:

```typescript
// Save state
const state = plugin.getState();
// state = { entries: [...] }

// Later, restore state
const newPlugin = new InContextMemoryPluginNextGen();
newPlugin.restoreState(state);
```

When using with `AgentContextNextGen`, the state is automatically included:

```typescript
// AgentContextNextGen synchronously captures plugin state
const ctxState = ctx.getState();

// Restore entire context (including InContextMemory)
const newCtx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { inContextMemory: true },
});
newCtx.restoreState(ctxState);  // Plugins are restored automatically
```

### Use Cases

**Ideal for:**
- **Current state/status** that changes during task execution
- **User preferences** for the session (theme, verbosity, etc.)
- **Counters and flags** (iteration count, feature flags)
- **Small accumulated results** (running totals, collected IDs)
- **Control variables** (abort flags, mode switches)
- **Live dashboards** (with `showInUI: true`) — progress trackers, status displays, structured results

**Not ideal for (use WorkingMemory instead):**
- Large data (documents, API responses, search results)
- Rarely accessed reference data
- Historical data that doesn't need instant access
- Data that exceeds 4000 tokens

### Best Practices

#### 1. Use Appropriate Priorities

```typescript
// Critical: Never evicted - for essential state
plugin.set('session_id', 'Session identifier', 'sess_123', 'critical');

// High: Kept as long as possible - important state
plugin.set('user_context', 'User context', { name: 'Alice' }, 'high');

// Normal (default): Standard data
plugin.set('current_step', 'Current step', 3);

// Low: Can be evicted - temporary/reconstructable data
plugin.set('last_check', 'Last health check', Date.now(), 'low');
```

#### 2. Keep Values Small

```typescript
// GOOD: Small, focused values
plugin.set('state', 'Task state', { step: 2, status: 'active' });

// BAD: Large objects (use WorkingMemory instead)
plugin.set('results', 'All results', hugeArrayOfResults);  // Don't do this!
```

#### 3. Clean Up When Done

```typescript
// Delete temporary entries when no longer needed
plugin.delete('temp_calculation');
plugin.delete('iteration_data');

// Or use low priority for auto-cleanup
plugin.set('temp', 'Temporary', value, 'low');
```

#### 4. Combine with WorkingMemory

Use both systems for their strengths:

```typescript
// Large data goes to WorkingMemoryPluginNextGen (index-based)
const memoryPlugin = ctx.getPlugin('working_memory') as WorkingMemoryPluginNextGen;
await memoryPlugin.store('search_results', 'Web search results', largeResults);

// Small, frequently-accessed state goes to InContextMemoryPluginNextGen (full values)
const inContextPlugin = ctx.getPlugin('in_context_memory') as InContextMemoryPluginNextGen;
inContextPlugin.set('search_status', 'Search status', { completed: 3, pending: 2 });

// LLM sees:
// - Memory Index: "search_results: Web search results" (needs store_get("notes", "search_results"))
// - Live Context: Full search_status value (instant access)
```

---

## Persistent Instructions (NextGen Plugin)

> ⚠️ **Deprecated** in favour of [`MemoryPluginNextGen`](#self-learning-memory-nextgen-plugin). This plugin keeps working unchanged for existing integrations — no breaking change — but new code should prefer the memory plugin, which replaces dumb KV with append-only facts + LLM-synthesised profiles that evolve from observations.

**PersistentInstructionsPluginNextGen** is a context plugin that stores agent-level custom instructions on disk as **individually keyed entries**. Unlike InContextMemory (volatile key-value pairs), persistent instructions survive process restarts and are automatically loaded when the agent starts.

### Key Difference from InContextMemory

| Feature | InContextMemory | Persistent Instructions |
|---------|-----------------|------------------------|
| **Storage** | In-memory (volatile) | Disk (persistent JSON) |
| **Survives restarts** | No | Yes |
| **Best for** | Session state, counters, flags | Agent personality, learned rules |
| **LLM can modify** | Yes (store_set("whiteboard", ...)) | Yes (store_set/store_delete("instructions", ...)) |
| **Auto-loaded** | Via session restore | Always on agent start |
| **Default capacity** | 20 entries, 40,000 tokens | 50 entries, 50,000 chars total |

### Quick Setup

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    agentId: 'my-assistant',  // Used for storage path
    features: {
      persistentInstructions: true,  // Enables PersistentInstructionsPluginNextGen
    },
  },
});

// Plugin is accessible via ctx.getPlugin('persistent_instructions')
// Instructions are automatically loaded from disk on first context prepare
```

### Manual Setup

For more control, you can set up the plugin manually:

```typescript
import { AgentContextNextGen, PersistentInstructionsPluginNextGen } from '@everworker/oneringai';

const ctx = AgentContextNextGen.create({ model: 'gpt-4.1' });

// Create and configure plugin
const plugin = new PersistentInstructionsPluginNextGen({
  agentId: 'my-assistant',
  maxTotalLength: 100000,  // Characters across all entries, default is 50000
  maxEntries: 50,          // Maximum number of keyed entries, default is 50
});

// Register with context
ctx.registerPlugin(plugin);

// Set instructions programmatically (keyed entries)
await plugin.set('personality', 'Always respond in a friendly tone.');
await plugin.set('formatting', 'Prefer bullet points for lists.');
```

### Configuration Options

```typescript
interface PersistentInstructionsConfig {
  /** Agent ID - used to determine storage path (required) */
  agentId: string;

  /** Custom storage implementation (default: FilePersistentInstructionsStorage) */
  storage?: IPersistentInstructionsStorage;

  /** Maximum total content length across all entries in characters (default: 50000) */
  maxTotalLength?: number;

  /** Maximum number of entries (default: 50) */
  maxEntries?: number;
}
```

### Storage Path

Instructions are stored at:
- **Unix/macOS**: `~/.oneringai/agents/<agentId>/custom_instructions.json`
- **Windows**: `%APPDATA%/oneringai/agents/<agentId>/custom_instructions.json`

The agent ID is sanitized to be filesystem-safe (lowercase, special chars replaced with underscores).

### Available Tools

The LLM manages persistent instructions through the unified `store_*` tools with `store="instructions"`:

#### store_set("instructions", ...)

Add or update a single instruction by key:

```jsonc
// Tool call from LLM
{
  "name": "store_set",
  "arguments": {
    "store": "instructions",
    "key": "personality",
    "data": {
      "content": "Always be friendly and helpful. Use clear, simple language."
    }
  }
}
// Returns: { "success": true, "message": "Instruction 'personality' added", "key": "personality", "contentLength": 57 }
```

#### store_delete("instructions", ...)

Remove a single instruction by key:

```jsonc
// Tool call from LLM
{
  "name": "store_delete",
  "arguments": {
    "store": "instructions",
    "key": "personality"
  }
}
// Returns: { "deleted": true, "key": "personality" }
```

#### store_list("instructions")

List all instructions with their keys and content:

```jsonc
// Tool call from LLM
{
  "name": "store_list",
  "arguments": {
    "store": "instructions"
  }
}
// Returns: {
//   "total": 2,
//   "entries": [
//     { "key": "personality", "contentLength": 57, "createdAt": ..., "updatedAt": ... },
//     { "key": "formatting", "contentLength": 35, "createdAt": ..., "updatedAt": ... }
//   ]
// }
```

#### store_action("instructions", "clear", ...)

Remove all instructions (requires confirmation):

```jsonc
// Tool call from LLM
{
  "name": "store_action",
  "arguments": {
    "store": "instructions",
    "action": "clear",
    "params": { "confirm": true }
  }
}
// Returns: { "success": true, "action": "clear", "message": "All custom instructions cleared" }
```

### Direct API Access

The plugin provides a programmatic API for direct manipulation:

```typescript
const plugin = ctx.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;

// Add/update entry by key
await plugin.set('personality', 'Always be friendly and helpful.');
await plugin.set('formatting', 'Use bullet points for lists.');

// Get single entry by key
const entry = await plugin.get('personality');  // InstructionEntry | null
// entry = { id: 'personality', content: '...', createdAt: ..., updatedAt: ... }

// Get all entries (sorted by createdAt)
const all = await plugin.get();  // InstructionEntry[] | null

// List metadata for all entries
const list = await plugin.list();
// [{ key: 'personality', contentLength: 35, createdAt: ..., updatedAt: ... }, ...]

// Remove a single entry
await plugin.remove('formatting');  // true if found, false if not

// Clear all
await plugin.clear();
```

### Context Output Format

When the LLM context is prepared, persistent instruction entries are rendered as markdown sections:

```markdown
### personality
Always be friendly and helpful. Use clear, simple language.

### formatting
- Use bullet points for lists
- Keep responses concise

### user_preferences
The user prefers dark mode and verbose explanations.
```

### Session Persistence

PersistentInstructionsPluginNextGen supports state serialization. The state format includes all entries:

```typescript
// State includes all entries
const state = plugin.getState();
// state = { entries: [...], agentId: "my-assistant", version: 2 }

// Restore state (useful for in-memory state sync)
plugin.restoreState(state);
// Also handles legacy format: { content: string | null, agentId: string }
```

### Use Cases

**Ideal for:**
- **Agent personality/behavior** - Tone, style, expertise areas
- **User preferences** - Formatting, verbosity, topics of interest
- **Learned rules** - Patterns discovered during conversation
- **Tool usage guidelines** - When to use specific tools
- **Custom instructions** - Domain-specific knowledge

**Example: Building a Learning Assistant**

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  instructions: `You are a learning assistant. When the user expresses preferences or
gives feedback about your responses, use store_set("instructions", key, { content }) to remember them for
future sessions. Use descriptive keys like "user_preferences", "response_style", etc.
Review your instructions with store_list("instructions") at the start of each conversation.`,
  context: {
    agentId: 'learning-assistant',
    features: { persistentInstructions: true },
  },
});

// User: "I prefer when you explain things with analogies"
// Agent calls: store_set("instructions", "response_style", { content: "Explain concepts using analogies when possible" })
// Next session, agent sees this in context automatically
```

### Best Practices

#### 1. Use Descriptive Keys

```typescript
// GOOD: Descriptive, categorical keys
await plugin.set('personality', 'Be friendly and approachable');
await plugin.set('formatting_rules', 'Use bullet points for lists');
await plugin.set('domain_knowledge', 'User works in fintech');

// AVOID: Generic or numbered keys
await plugin.set('rule1', '...');  // Not descriptive
await plugin.set('misc', '...');   // Too vague
```

#### 2. One Concern Per Entry

```typescript
// GOOD: Each entry covers one topic
await plugin.set('tone', 'Use formal language');
await plugin.set('code_style', 'Use TypeScript, follow existing patterns');
await plugin.set('response_length', 'Keep responses concise, 2-3 paragraphs max');

// AVOID: Mixing concerns in one entry
await plugin.set('rules', 'Be formal. Use TypeScript. Keep it short.');
```

#### 3. Combine with InContextMemory

Use both systems for their strengths:

```typescript
// Persistent instructions for long-term knowledge
// - Agent personality
// - User preferences
// - Learned rules

// InContextMemory for session-specific state
// - Current task progress
// - Temporary flags
// - Running totals
```

#### 4. Set Reasonable Limits

```typescript
// For simple agents
const agent = Agent.create({
  context: {
    features: { persistentInstructions: true },
    plugins: { persistentInstructions: { maxTotalLength: 10000, maxEntries: 20 } },
  },
});

// For complex agents with lots of learned rules
const agent = Agent.create({
  context: {
    features: { persistentInstructions: true },
    plugins: { persistentInstructions: { maxTotalLength: 100000, maxEntries: 100 } },
  },
});
```

### Upgrade Guide (from single-string to KVP)

If upgrading from the previous single-string persistent instructions:

1. **File storage**: Auto-migrated. Legacy `custom_instructions.md` files are read as a single `legacy_instructions` entry and converted to `custom_instructions.json` on next save. No action needed.
2. **Custom storage backends**: Update `load()` to return `InstructionEntry[] | null` and `save()` to accept `InstructionEntry[]` instead of `string`.
3. **Tool API**: `instructions_append` is removed — use `store_set("instructions", key, { content })` to add new entries. `instructions_get` is removed — use `store_list("instructions")` to see all entries.
4. **Programmatic API**: `plugin.set(content)` → `plugin.set(key, content)`. `plugin.append(section)` → `plugin.set(newKey, section)`. `plugin.get()` now returns `InstructionEntry[] | null` (or a single `InstructionEntry` when called with a key).
5. **Session state**: Existing saved sessions with old format (`{ content: string | null }`) are auto-migrated on `restoreState()`.

---

## Direct LLM Access

Agent inherits `runDirect()` and `streamDirect()` methods from BaseAgent. These methods bypass all context management for simple, stateless LLM calls.

### When to Use Direct Access

| Use Case | Recommended Method |
|----------|-------------------|
| Conversational agent with history | `run()` |
| Task with memory and tools | `run()` with context features |
| Per-call reasoning control | `run(input, { thinking })` |
| Quick one-off query | `runDirect()` |
| Embedding-like simplicity | `runDirect()` |
| Testing/debugging | `runDirect()` |
| Hybrid workflows | Mix both |

### Basic Usage

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });

// Direct call - bypasses all context management
const response = await agent.runDirect('What is 2 + 2?');
console.log(response.output_text);  // "4"

// Conversation is NOT affected
console.log(agent.context.getConversation().length);  // 0
```

### DirectCallOptions

```typescript
interface DirectCallOptions {
  /** System instructions */
  instructions?: string;

  /** Include registered tools (default: false) */
  includeTools?: boolean;

  /** Explicit per-call definitions (used instead of registered tools) */
  tools?: Tool[];

  /** Tool-selection policy for explicit or included tools */
  toolChoice?: 'auto' | 'required' | { type: 'function'; function: { name: string } };

  /** Temperature for generation */
  temperature?: number;

  /** Maximum output tokens */
  maxOutputTokens?: number;

  /** Continue a provider-stored response/interaction */
  previousResponseId?: string;

  /** Vendor-agnostic structured (JSON) output */
  responseFormat?:
    | { type: 'json_object' }
    | { type: 'json_schema'; schema: Record<string, unknown>; name?: string; description?: string; strict?: boolean };

  /** Vendor-agnostic thinking/reasoning configuration */
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;   // Fixed-budget models
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };

  /** Vendor-specific options */
  vendorOptions?: Record<string, unknown>;

  /** Provider-neutral prompt-cache policy */
  promptCache?: PromptCachePolicy;

  /** Provider-hosted tools (not executed by ToolManager) */
  nativeTools?: NativeToolRequest[];

  /** Explicit permission for retention-sensitive provider features */
  dataHandling?: DataHandlingPolicy;

  /** Skip the provider pre-flight context limit check (default: false) */
  skipContextLimitCheck?: boolean;
}
```

### Examples

```typescript
// With options
const response = await agent.runDirect('Summarize this text', {
  instructions: 'Be concise. Use bullet points.',
  temperature: 0.5,
  maxOutputTokens: 200,
});

// JSON response
const response = await agent.runDirect('List 3 fruits', {
  responseFormat: { type: 'json_object' },
  instructions: 'Return a JSON array of fruit names',
});

// Multimodal (text + image)
const response = await agent.runDirect([
  {
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: 'What is in this image?' },
      { type: 'input_image', image_url: 'https://example.com/image.png' }
    ]
  }
]);

// With tools (single call - you handle tool calls manually)
const response = await agent.runDirect('Get the weather in Paris', {
  includeTools: true,
});
// If response contains tool_calls, you must execute them yourself
if (response.output.some(item => item.type === 'function_call')) {
  // Handle tool calls manually
}
```

### Streaming

```typescript
// Stream responses for real-time output
for await (const event of agent.streamDirect('Tell me a story')) {
  if (event.type === 'output_text_delta') {
    process.stdout.write(event.delta);
  }
}

// With options
for await (const event of agent.streamDirect('Explain quantum computing', {
  instructions: 'Use simple terms',
  temperature: 0.7,
})) {
  // Handle events...
}
```

### Per-Call RunOptions

`run()` and `stream()` accept an optional second argument to override agent-level config for a single invocation:

```typescript
interface RunOptions {
  /** Vendor-agnostic thinking/reasoning configuration */
  thinking?: {
    enabled: boolean;
    budgetTokens?: number;         // Fixed-budget models
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  };

  /** Temperature override */
  temperature?: number;

  /** Vendor-specific options (shallow-merged with agent-level vendorOptions) */
  vendorOptions?: Record<string, unknown>;

  /** Provider-neutral prompt-cache policy */
  promptCache?: PromptCachePolicy;

  /** Provider-hosted tools (not executed by ToolManager) */
  nativeTools?: NativeToolRequest[];

  /** Explicit permission for retention-sensitive provider features */
  dataHandling?: DataHandlingPolicy;

  /** Vendor-agnostic structured (JSON) output override for this call */
  responseFormat?:
    | { type: 'json_object' }
    | { type: 'json_schema'; schema: Record<string, unknown>; name?: string; description?: string; strict?: boolean };
}
```

```typescript
// Override reasoning effort per call
const deep = await agent.run('Prove this theorem', {
  thinking: { enabled: true, effort: 'high' },
});

const quick = await agent.run('What is 2+2?', {
  thinking: { enabled: true, effort: 'low' },
});

// Override temperature per call
const creative = await agent.run('Write a poem', { temperature: 0.9 });

// Streaming with per-call options
for await (const event of agent.stream('Analyze this', {
  thinking: { enabled: true, budgetTokens: 16384 },
})) {
  // ...
}
```

RunOptions take precedence over agent-level config. `vendorOptions` are shallow-merged (per-call keys override agent-level keys). Advanced inference options replace their agent-level value as a whole; see [Advanced Inference](#advanced-inference) for the complete contract.

### Thinking / Reasoning

Vendor-agnostic reasoning configuration that maps to each provider's native API:

| Provider | `effort` maps to | `budgetTokens` maps to |
|----------|-----------------|----------------------|
| OpenAI | `reasoning.effort` | N/A |
| Anthropic | `output_config.effort` | `thinking.budget_tokens` on fixed-budget models |
| Google | Gemini thinking level (the exact supported subset is model-dependent) | `thinkingConfig.thinkingBudget` on fixed-budget models |

```typescript
// Agent-level (applies to all calls)
const agent = Agent.create({
  connector: 'openai', model: 'o3-mini',
  thinking: { enabled: true, effort: 'medium' },
});

// Per-call override
await agent.run('Complex analysis', { thinking: { enabled: true, effort: 'high' } });
await agent.run('Simple lookup', { thinking: { enabled: true, effort: 'low' } });

// Anthropic with budget tokens
const agent2 = Agent.create({ connector: 'anthropic', model: 'claude-sonnet-4-6' });
await agent2.run('Deep reasoning task', { thinking: { enabled: true, budgetTokens: 16384 } });

// runDirect() also supports thinking
await agent.runDirect('Quick Q', { thinking: { enabled: true, effort: 'low' } });
```

The normalized `thinking.enabled` flag gates both its nested `effort` and
budget. Anthropic also supports native effort independently of thinking; use
`vendorOptions: { effort: 'low' | 'medium' | 'high' | ... }` when that distinct
provider behavior is intended while normalized thinking is disabled.

### Comparison: run() vs runDirect()

| Aspect | `run()` | `runDirect()` |
|--------|-------------------|---------------|
| History tracking | ✅ Automatic | ❌ None |
| WorkingMemory | ✅ Available | ❌ Not used |
| Context preparation | ✅ Full preparation | ❌ None |
| Agentic loop | ✅ Executes tools automatically | ❌ Single call only |
| Compaction | ✅ Auto-compacts when needed | ❌ None |
| Overhead | Full context management | Minimal |

### Hybrid Workflows

You can mix both approaches in the same agent:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool, searchTool],
});

// Use run() for complex interactions with tool use
await agent.run('Search for the latest news and summarize');

// Use runDirect() for quick follow-ups that don't need context
const clarification = await agent.runDirect(
  'What is a good synonym for "excellent"?',
  { temperature: 0.3 }
);

// Back to run() for continued conversation
await agent.run('Now tell me more about the first item');
```

---

## User Info (NextGen Plugin)

> ⚠️ **Deprecated** in favour of [`MemoryPluginNextGen`](#self-learning-memory-nextgen-plugin). This plugin keeps working unchanged; the memory plugin supersedes it with facts-over-KV, supersession-preserved history, LLM-synthesised profiles, three-principal permissions, and semantic recall.

Store user-specific preferences and context that persist across sessions and agents. Unlike other plugins, user info is **user-scoped** (not agent-scoped) — different agents share the same user's data.

User info entries are **automatically injected into the LLM system message** as markdown, so the LLM always knows the user's preferences without needing to call `store_get("user_info")` each turn.

### Setup

```typescript
import { Agent } from '@everworker/oneringai';

// Single-user app — no userId needed
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    features: { userInfo: true },
  },
});

// Multi-user app — opt-in per-user isolation
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'alice',
  context: {
    features: { userInfo: true },
  },
});
```

### How It Works

1. **Lazy Loading** — On first access (tool call or `getContent()`), entries are loaded from storage into an in-memory cache
2. **Context Injection** — `getContent()` renders entries as markdown in the system message. Regular user info and TODOs are shown in separate sections:
   ```
   ### theme
   dark

   ### language
   en

   ## Current TODOs
   - [ ] todo_a1b2c3: Review PR for auth module (due: 2026-03-01, people: Alice) [work]
     Check the error handling changes
   - [x] todo_d4e5f6: Buy groceries (due: 2026-02-25) [personal]
   ```
3. **Write-Through** — Tool mutations (set/remove/clear) update both the in-memory cache and persist to storage immediately
4. **Session Persistence** — `getState()`/`restoreState()` serialize/deserialize entries for session save/load

### User Info Tools

| Tool Call | Description | Permission |
|-----------|-------------|------------|
| `store_set("user_info", key, { value, description? })` | Store/update entry by key | Always allowed |
| `store_get("user_info", key?)` | Retrieve one entry by key, or all entries (key optional) | Always allowed |
| `store_delete("user_info", key)` | Remove a specific entry by key | Always allowed |
| `store_action("user_info", "clear", { confirm: true })` | Clear all entries | Requires approval |

### TODO Tools

TODOs are stored as user info entries with a `todo_` key prefix. They are rendered in a dedicated **"Current TODOs"** checklist section in context, separate from regular user info.

| Tool | Description | Permission |
|------|-------------|------------|
| `todo_add` | Create a TODO (`title`, `description?`, `people?`, `dueDate?`, `tags?`) | Always allowed |
| `todo_update` | Update a TODO — partial updates (`id`, `title?`, `description?`, `people?`, `dueDate?`, `tags?`, `status?`) | Always allowed |
| `todo_remove` | Delete a TODO by id | Always allowed |

**TODO fields:**
- `title` (required) — short description of the task
- `description` (optional) — additional details
- `people` (optional) — other people involved besides the current user
- `dueDate` (optional) — deadline in `YYYY-MM-DD` format
- `tags` (optional) — categorization tags (e.g. `["work", "urgent"]`)
- `status` — `'pending'` or `'done'`

**Agent behavior (built into plugin instructions):**
- **Proactive creation** — When conversation implies an action item, the agent suggests creating a TODO. Explicit requests like "remind me" or "track this" create one immediately.
- **Daily reminders** — Once per day, the agent reminds about overdue and soon-due items (within 2 days). Uses a `_todo_last_reminded` internal entry to avoid repeating.
- **Auto-cleanup** — Completed TODOs older than 48 hours are automatically removed. Pending TODOs overdue by more than 7 days prompt the user: "Still relevant or should I remove it?"

### Storage

- **Default path:** `~/.oneringai/users/<userId>/user_info.json` (defaults to `~/.oneringai/users/default/user_info.json`)
- **Custom storage:** Implement `IUserInfoStorage` and pass via config or `StorageRegistry`

```typescript
// Via StorageRegistry
StorageRegistry.set('userInfo', (context?: StorageContext) => {
  return new MongoUserInfoStorage(collection);
});
```

### Configuration

```typescript
interface UserInfoPluginConfig {
  storage?: IUserInfoStorage;    // Custom storage backend
  maxTotalSize?: number;         // Default: 100000 (~100KB)
  maxEntries?: number;           // Default: 100
  userId?: string;               // Auto-set from AgentContextNextGen._userId
}
```

### Differences from Other Plugins

| | PersistentInstructions | UserInfo | InContextMemory |
|---|---|---|---|
| **Scope** | Agent-scoped | User-scoped | Session only |
| **Storage key** | `agentId` | `userId` | None (in memory) |
| **Persists to disk** | Yes | Yes | No |
| **In system message** | Yes | Yes | Yes |
| **Value type** | `string` | `unknown` (any JSON) | `unknown` (any JSON) |

### Use Cases

- User preferences: theme, language, timezone, notification settings
- User context: role, location, department
- Accumulated knowledge about the user
- Profile information the LLM should always have access to
- TODO tracking: tasks with deadlines, involved people, and tags — with proactive reminders and auto-cleanup

> ⚠️ **Deprecated** in favour of the Self-Learning Memory plugin below. `UserInfoPluginNextGen` keeps working unchanged; the memory plugin supersedes it with append-only facts (history preserved via supersession), LLM-synthesised profiles that evolve with new observations, three-principal permissions, and semantic recall.

---

## Self-Learning Memory (NextGen Plugin)

The Self-Learning Memory system is a brain-like, queryable knowledge store that lets agents *learn from observation* — the user's profile and any user-given behavior rules are injected into the system message on every turn, and the agent can read or mutate the knowledge graph mid-conversation through 12 dedicated tools. It supersedes both `PersistentInstructionsPluginNextGen` and `UserInfoPluginNextGen`.

The underlying `MemorySystem` is a first-class standalone module: it has no
dependency on `Agent` or the context plugins. Server code can use its entity and
fact model, vector embeddings, document search, graph traversal, bitemporal
queries, signal ingestion, profile generation, storage adapters, and permission
model directly. The context plugins are adapters that expose that same system
to an LLM safely; they are not the memory implementation itself.

This section is the user-guide-level walkthrough. For the full conceptual model, adapter setup, signal ingestion pipeline, predicate vocabulary, and resolution tiers, see:
- [docs/MEMORY_GUIDE.md](./docs/MEMORY_GUIDE.md) — the canonical memory layer guide.
- [docs/MEMORY_API.md](./docs/MEMORY_API.md) — full `MemorySystem` API reference.
- [docs/MEMORY_PERMISSIONS.md](./docs/MEMORY_PERMISSIONS.md) — three-principal permission model.
- [docs/MEMORY_SIGNALS.md](./docs/MEMORY_SIGNALS.md) — signal → fact extraction.
- [docs/MEMORY_PREDICATES.md](./docs/MEMORY_PREDICATES.md) — predicate registry.

### What it is

Two first-class concepts:

- **Entities** are pure identity. People, organizations, projects, tasks, events, topics — each carries a `displayName`, `aliases`, strong `identifiers` (email, domain, slack_id, github, custom canonical id), and type-specific `metadata` (e.g. task `state` / `dueAt`, event `startTime` / `attendeeIds`).
- **Facts** are knowledge. Triples like `(John, works_at, Microsoft)` or document facts (long-form prose). Facts carry `confidence`, `importance`, `sourceSignalId`, temporal validity (`validFrom` / `validUntil`), supersession links, and can bind to additional entities via `contextIds` ("this fact is about John but also relates to the Acme deal").

Facts preserve history through supersession; task entities are mutable through
the state-machine API and keep a bounded `stateHistory`. Every record has an
owner, can be tenant-scoped by group, supports owner/group/world permissions
plus explicit principal ACLs, and is retrievable as profile + ranked facts +
related tasks + related events in one query.

**Self-learning loop:**
1. The user tells the agent something ("I prefer concise answers"), or a background ingestor extracts facts from the conversation.
2. A fact lands in the store via `memory_remember` (LLM-driven) or `SessionIngestorPluginNextGen` (passive).
3. When the new-facts threshold is crossed (default 3), **incremental profile regeneration** fires in the background — the configured LLM gets the prior profile + new facts + invalidated IDs and returns an evolved profile document.
4. On the next turn, the system message reflects the change. No manual prompt engineering.

### When to use which plugin

| Plugin | Feature flag | Purpose |
|---|---|---|
| `WorkingMemoryPluginNextGen` | `workingMemory` (default true) | Ephemeral per-session scratchpad with tiered eviction (raw / summary / findings). NOT a knowledge store. |
| `InContextMemoryPluginNextGen` | `inContextMemory` (default true) | Live KV values rendered directly in the system message. Use for small, high-signal state the LLM must always see. |
| **`MemoryPluginNextGen`** | `memory` (default false) | **Recommended.** Self-learning knowledge store. Read-side: profile injection + 6 retrieval tools. |
| **`MemoryWritePluginNextGen`** | `memoryWrite` (default false) | Optional sidecar — adds the 6 write `memory_*` tools. Requires `memory: true`. |
| `SessionIngestorPluginNextGen` | n/a (registered manually) | Background pipeline — extracts facts from each batch of messages and writes them to the same `MemorySystem`. Pair with `memory: true` (no `memoryWrite`) for retrieval-only agents whose memory updates happen passively. |
| `PersistentInstructionsPluginNextGen`, `UserInfoPluginNextGen` | `persistentInstructions`, `userInfo` | ⚠️ Deprecated — use `MemoryPluginNextGen` instead. |

### Quick Start (in-process, dev)

```typescript
import {
  Agent,
  createMemorySystemWithConnectors,
  InMemoryAdapter,
  PredicateRegistry,
} from '@everworker/oneringai';

const predicates = PredicateRegistry.standard().register({
  name: 'prefers',
  description: 'A durable user preference.',
  category: 'preference',
  payloadKind: 'attribute',
  subjectTypes: ['person'],
  lifecycle: 'stable',
});

// 1. Build the MemorySystem. Embedder + profile-generator are optional but
//    recommended (without them: no semantic search, no profile auto-regen).
const memory = createMemorySystemWithConnectors({
  store: new InMemoryAdapter(),
  connectors: {
    embedding: { connector: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    profile:   { connector: 'anthropic', model: 'claude-sonnet-4-6' },
  },
  predicates,
  predicateMode: 'strict',
  visibilityPolicy: () => ({ group: 'read', world: 'none' }),
});

// 2. Agent with feature flags + plugin config (under `context.features` /
//    `context.plugins`).
const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  userId: 'alice',                              // REQUIRED — memory's owner invariant
  context: {
    agentId: 'my-assistant',                    // optional — auto-generated if omitted
    features: {
      memory: true,                             // reads: profile injection + 6 retrieval tools
      memoryWrite: true,                        // writes: 6 mutation tools (omit for retrieval-only)
    },
    plugins: {
      memory: {
        memory,                                 // the MemorySystem instance — shared by both plugins
        // groupId: 'team-A',                   // optional, trusted from your auth layer
        // userDisplayName: 'Alice Smith',
        // userProfileInjection: { topFacts: 20, relatedTasks: true },
      },
      // `memoryWrite` inherits memory / agentId / userId from plugins.memory.
    },
  },
});

await agent.run('Remember that I prefer concise answers');
await agent.run('What are my preferences?');
// → The fact is available to retrieval immediately and appears in injected
//   top facts; the synthesized profile refreshes after the configured threshold.
```

> The `context.features.memory` and `context.features.memoryWrite` flags are independent. `memoryWrite: true` requires `memory: true`. Enable just `memory` for a retrieval-only agent (and pair with `SessionIngestorPluginNextGen` to keep memory growing passively).

### Storage backends

`MemorySystem` is an `IMemoryStore` adapter away from any database. Three adapters ship out of the box; full setup details live in [docs/MEMORY_GUIDE.md § Choosing a storage backend](./docs/MEMORY_GUIDE.md#choosing-a-storage-backend).

| Adapter | When to use |
|---|---|
| `InMemoryAdapter` | Tests, REPL, single-user desktop apps that snapshot externally. Zero deps. |
| `MongoMemoryAdapter` + `RawMongoCollection` | Production servers using the `mongodb` driver. Supports native `$graphLookup` and Atlas Vector Search. |
| `MongoMemoryAdapter` + `MeteorMongoCollection` | Meteor apps — writes flow through Meteor's async API and trigger reactive publications. |

```typescript
import { MongoClient } from 'mongodb';
import {
  MongoMemoryAdapter,
  RawMongoCollection,
} from '@everworker/oneringai';

const client = await new MongoClient(url).connect();
const db = client.db('myapp');
const entitiesColl = new RawMongoCollection(db.collection('memory_entities'), client);
const factsColl   = new RawMongoCollection(db.collection('memory_facts'), client);
const memoryAdapter = new MongoMemoryAdapter({
  entities: entitiesColl,
  facts: factsColl,
  factsCollectionName: 'memory_facts',     // required for native $graphLookup
  useNativeGraphLookup: true,
  vectorIndexName: 'memory_facts_vector',
  entityVectorIndexName: 'memory_entities_identity_vector',
  entityContentVectorIndexName: 'memory_entities_content_vector',
});

const memory = createMemorySystemWithConnectors({
  store: memoryAdapter,
  connectors: {
    embedding: { connector: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    profile:   { connector: 'anthropic', model: 'claude-sonnet-4-6' },
  },
});

// Run once on startup — creates all required performance + correctness indexes.
await memory.ensureAdapterIndexes();

// For semantic search at scale, also create Atlas Vector Search indexes
// programmatically (UI creation is a security footgun — see MEMORY_GUIDE.md).
await memoryAdapter.ensureVectorSearchIndexes({ dimensions: 1536 });
```

> Mongo deployments need two host-managed uniqueness migrations in addition to
> `ensureAdapterIndexes()`: a unique partial index on
> `{identifiers.kind: 1, identifiers.value: 1}` to prevent connector/bootstrap
> identity races, and `ensureNormalizedNameUniqueIndex(entitiesColl)` to make
> normalized-name find-or-create atomic across processes. For an existing
> database, backfill normalized fields and deduplicate before installing either
> index; the library intentionally cannot make that destructive migration for
> you. See the Memory Guide's Mongo deployment checklist.

### What gets injected into the system message

Up to four blocks are rendered when `features.memory: true` (the rules block and the priorities block only appear when applicable facts exist):

```
## Your persona — how YOU (the assistant) present yourself
_These lines define the ASSISTANT — you, the AI — NOT the user. Each line begins with `[ruleId=<id>]` — pass that exact id to `memory_set_agent_rule.replaces` to supersede or to `memory_forget.factId` to drop._
- [ruleId=fact_abc123_…] Be terse in replies.
- [ruleId=fact_def456_…] Reply in English again.

## About the User (Alice Smith)
Alice prefers concise replies, leads product strategy at Acme, …

### Recent top facts (up to 20)
- prefers: "concise answers" (conf=1.00)
- works_at: Acme (conf=0.95)
- role: "product lead" (conf=0.9)

## User's Active Priorities        ← only when the user has tracks_priority facts
- **Ship NA launch** _(horizon=Q, weight=0.80, deadline=2026-06-30T00:00:00.000Z)_

## About the User's Organization (Acme)        ← only when groupBootstrap is set
Acme is a 500-person SaaS company in the logistics space …

### Recent top facts (up to 20)
- …
```

The blocks are rendered **before** every LLM call, never trimmed by compaction (`isCompactable() === false`). Empty blocks are omitted — a brand-new user with no facts gets nothing rendered until something is learned.

> Global agent personality / base instructions are NOT auto-rendered any more — set them via `Agent.create({ instructions })`. The `agent` entity still exists for graph queries and as the `this_agent` subject for `memory_set_agent_rule`, but its profile is not synthesised or injected.

### Plugin config

```typescript
interface MemoryPluginConfig {
  memory: MemorySystem;                  // REQUIRED
  agentId: string;                       // auto-filled from context.agentId
  userId: string;                        // auto-filled from agent.userId
  groupId?: string;                      // TRUSTED — from your auth layer
  principals?: string[];                 // TRUSTED host-resolved ACL principal set
  timezone?: string;                     // Viewer IANA timezone for rendered instants

  // Optional shared persona subject for multiple agent variants.
  personaEntityId?: string;

  // Permissions stamped on the bootstrapped user / agent / group entities.
  userEntityPermissions?:  { group?: 'none'|'read'|'write'; world?: 'none'|'read'|'write' };
  agentEntityPermissions?: { group?: 'none'|'read'|'write'; world?: 'none'|'read'|'write' };

  // Optional org bootstrap — when set AND groupId is set, a third entity
  // (`organization`, identifier `system_group_id`) is upserted and rendered
  // as "About the User's Organization". Visibility of facts on it is controlled
  // by your MemorySystem.visibilityPolicy + per-write permissions.
  groupBootstrap?: {
    displayName: string;
    identifiers?: { kind: string; value: string }[];   // e.g. [{kind:'domain', value:'acme.com'}]
    permissions?: { group?: 'none'|'read'|'write'; world?: 'none'|'read'|'write' };
  };

  // What to inject for each profile block. Defaults to { profile:true, topFacts:20,
  // recentActivity: { limit: 20, windowDays: 7 } }.
  userProfileInjection?:  ProfileInjection;
  groupProfileInjection?: ProfileInjection;

  // Legacy compatibility field. The 1.0 write tools do not consult it when
  // the LLM omits visibility; configure MemorySystem.visibilityPolicy instead.
  defaultVisibility?: {
    forUser?:  'private' | 'group' | 'public';
    forAgent?: 'private' | 'group' | 'public';
    forOther?: 'private' | 'group' | 'public';
  };

  autoResolveThreshold?: number;        // Fuzzy-match threshold for {surface}. Default 0.9.
  userDisplayName?: string;             // Used on first bootstrap; ignored if entity exists.
  agentDisplayName?: string;            // Same.
}

interface ProfileInjection {
  profile?: boolean;          // Include profile.details. Default true.
  topFacts?: number;          // Top N ranked facts. 0 disables. Default 20 (cap 100).
  factPredicates?: string[];  // Restrict topFacts to these predicates.
  relatedTasks?: boolean;     // Include active related tasks. Default false.
  relatedEvents?: boolean;    // Include recent related events. Default false.
  identifiers?: boolean;      // Render entity identifier list. Default false.
  maxFactLineChars?: number;  // Cap each rendered fact line. Default undefined (no cap).
  recentActivity?: {          // Time-ordered "Recent activity" tail. Default ON, limit 20, 7d.
    limit?: number;           // 0 disables.
    windowDays?: number;
    predicates?: string[];    // Optional predicate allowlist.
  };
}

interface MemoryWritePluginConfig {
  memory: MemorySystem;                  // REQUIRED
  agentId: string;                       // auto-filled
  userId: string;                        // auto-filled
  groupId?: string;
  predicates?: PredicateRegistry;       // Usually inherited from MemorySystem.
  defaultVisibility?: { /* same shape as above */ };
  autoResolveThreshold?: number;
  forgetRateLimit?: { maxCallsPerWindow?: number; windowMs?: number };       // default 10/60s/user; also fallback for setAgentRuleRateLimit
  setAgentRuleRateLimit?: { maxCallsPerWindow?: number; windowMs?: number }; // default: falls back to forgetRateLimit, then 10/60s/user
  forbiddenEntityTypes?: readonly string[]; // Reject host-managed entity types.
}
```

### The 12 `memory_*` tools

All tools accept a flexible **`SubjectRef`** so the LLM never has to know an entity id:

```typescript
type SubjectRef =
  | string                                             // entity id, "me", or "this_agent"
  | { id: string }
  | { identifier: { kind: string; value: string } }    // exact identifier match
  | { surface: string };                               // fuzzy resolution by name/alias
```

**Read tools (6)** — registered when `features.memory: true`:

| Tool | What it does | Example |
|------|--------------|---------|
| `memory_recall` | Profile + top facts + optional tiers (`documents` / `semantic` / `neighbors`) | `{"subject":"me"}` · `{"subject":{"surface":"Acme deal"},"include":["neighbors"]}` |
| `memory_graph` | N-hop graph traversal (Mongo `$graphLookup` for `direction:'out'`/`'in'`; iterative BFS for `'both'`) | `{"start":"me","direction":"out","maxDepth":2}` |
| `memory_search` | Semantic text search across embedded facts | `{"query":"deployment incidents last quarter","topK":10}` |
| `memory_search_documents` | Search long-form documents (`type='document'`) by content. `mode:'semantic'\|'keyword'`; filters by `attachedTo` / `role`. | `{"query":"Q3 launch brief"}` · `{"query":"TODO","mode":"keyword","role":"notes"}` |
| `memory_find_entity` | Lookup or list by id, identifier, surface, or type+metadata (read-only — actions: `find` / `list`) | `{"by":{"identifier":{"kind":"email","value":"alice@a.com"}}}` |
| `memory_list_facts` | Paginated raw fact enumeration; `archivedOnly: true` returns audit view | `{"subject":"me","predicate":"prefers"}` |

**Write tools (6)** — registered when `features.memoryWrite: true` (requires `memory: true`):

| Tool | What it does | Example |
|------|--------------|---------|
| `memory_remember` | Write an atomic fact (or document fact via `kind: "document"` + `details`) | `{"subject":"me","predicate":"prefers","value":"concise"}` |
| `memory_link` | Write a relational fact between two entities | `{"from":{"surface":"Alice"},"predicate":"attended","to":{"surface":"Q3 planning"}}` |
| `memory_upsert_entity` | Create or merge an entity by identifiers (multi-ID auto-merge) | `{"type":"person","displayName":"Alice","identifiers":[{"kind":"email","value":"alice@a.com"}]}` |
| `memory_forget` | Archive a fact (optionally supersede with a correction). Rate-limited 10/60s/user. | `{"factId":"fact_xyz","replaceWith":{"predicate":"role","value":"senior engineer"}}` |
| `memory_restore` | Un-archive a previously forgotten fact (undo). Rejects when superseded by a live successor. | `{"factId":"fact_xyz"}` |
| `memory_set_agent_rule` | Record a user-specific behavior rule for THIS agent. Rendered back into the system-message rules block. | `{"rule":"Be terse in replies."}` · `{"rule":"Reply in Russian.","replaces":"fact_abc123"}` |

**Write visibility:** the LLM-facing schemas for `memory_remember`,
`memory_link`, and `memory_upsert_entity` deliberately do not expose a
`visibility` argument. When those tools write a record, they pass no explicit
permissions and `MemorySystem.visibilityPolicy` decides what to stamp. Configure
that policy at the memory-system boundary; do not rely on prompt instructions
for authorization. Programmatic callers using `MemorySystem` directly can pass
explicit `permissions`.

**Multi-ID enrichment** — `memory_upsert_entity` auto-merges identifiers when any one matches an existing entity. Useful when the LLM observes a person via Slack today and via email tomorrow:

```json
{"type":"person","displayName":"Alice Smith",
 "identifiers":[{"kind":"email","value":"alice@a.com"},
                {"kind":"slack_user_id","value":"U07ABC"}]}
```

If any identifier already belongs to an entity, the others are added to it — so future `memory_find_entity` lookups by either identifier resolve to the same Alice.

### Behavior rules — `memory_set_agent_rule`

When the user gives a directive about *the agent itself* ("be terse", "stop apologizing", "reply in Russian", "your name is Jason now"), the LLM calls `memory_set_agent_rule`. The rule is stored as a fact on the agent entity scoped to the calling user (`ownerId = userId`, `predicate = 'agent_behavior_rule'`, importance 0.95, private visibility) and rendered back into the **`## Your persona — how YOU (the assistant) present yourself`** block on every subsequent turn. Each rule shows its `ruleId` so the LLM can pass `replaces` to supersede it cleanly when the user contradicts a prior rule.

The plugin's instructions teach the LLM a narrow trigger:

- ✅ Identity / name / persona, role assignment, tone, format, language, meta-interaction rules.
- ❌ Task creation ("remind me to X" → `memory_upsert_entity` task or a tracker connector), calendar actions, factual corrections, user statements about themselves.

Rules are scoped per-user-per-agent — another user of the same agent gets a different set, all derived from the same single `agentEntityId` plus per-fact `ownerId` filtering.

### Background ingestion via `SessionIngestorPluginNextGen`

`memory_*` write tools depend on the agent remembering to call them. For deployments where the agent should be retrieval-only or where you want belt-and-suspenders capture, register `SessionIngestorPluginNextGen` alongside `MemoryPluginNextGen`. It hooks `onBeforePrepare`, snapshots the conversation slice since its watermark, and (when the slice meets `minBatchMessages`) kicks off an async LLM extraction that writes facts directly to the same `MemorySystem`.

```typescript
import { SessionIngestorPluginNextGen } from '@everworker/oneringai';

// After Agent.create(...):
agent.context.registerPlugin(new SessionIngestorPluginNextGen({
  memory,
  agentId: agent.context.agentId,
  userId: 'alice',
  groupId: 'team-A',                    // optional, trusted
  connectorName: 'fast-extractor',      // REQUIRED — typically a cheap, NON-reasoning model
  model: 'gpt-4.1',
  diligence: 'normal',                  // 'minimal' | 'normal' | 'thorough'
  minBatchMessages: 6,                  // default
}));
```

Pair `memory: true` with the ingestor (and **without** `memoryWrite`) for an agent that reads memory but never mutates it directly — useful when the agent operator wants ambient learning without trusting the LLM to write. See [docs/MEMORY_GUIDE.md § Learning from agent runs](./docs/MEMORY_GUIDE.md#learning-from-agent-runs-with-sessioningestorpluginnextgen) for batching, watermark, dedup-merge, and graceful-shutdown details.

> On graceful shutdown the host MUST `await ingestor.flush()` before destroying the agent — `flush()` ignores the batch threshold and awaits completion, so the trailing batch is captured.

For **non-agent flows** (process this email / text now, no conversation involved), use `SignalIngestor` directly — see [docs/MEMORY_SIGNALS.md](./docs/MEMORY_SIGNALS.md). Reference adapters: `EmailSignalAdapter`, `CalendarSignalAdapter`, `PlainTextAdapter`. Custom adapters implement `SignalSourceAdapter`.

### Permissions and scope

Every entity and fact carries:
- **`ownerId`** (required) — the user who created the record. Owner always has full access.
- **`groupId`** (optional) — the group the record belongs to.
- **`permissions: { group?, world? }`** — `'none' | 'read' | 'write'`. Defaults: `group: 'read'`, `world: 'read'` (public-read, owner-write).

Reads are filtered at the storage adapter (defence-in-depth); writes are checked at the `MemorySystem` layer (`assertCanAccess(..., 'write')` throws `PermissionDeniedError`). Scope visibility cuts orthogonal: a record with `groupId: 'A'` is invisible to callers in group `'B'` regardless of permissions.

The plugin config still accepts `defaultVisibility` for compatibility, but the
current write-tool implementations do not apply it when the LLM omits
visibility. Use `MemorySystem.visibilityPolicy` for deployment-wide defaults.
`memory_set_agent_rule` is a special case: it always writes the user-specific
agent rule as private. Writes whose `contextIds` include foreign or
unverifiable entities are fail-safe restricted to owner-only visibility.
Full model: [docs/MEMORY_PERMISSIONS.md](./docs/MEMORY_PERMISSIONS.md).

### Principal-based ACLs (explicit grants)

Owner / group / world handles the common cases, but it can't say *"this **specific** other person, agent, or service can read this record."* The principal-ACL layer adds that — explicit per-identity grants that sit **alongside** owner/group/world. It is fully opt-in and backwards compatible: set no `acl` and pass no `scope.principals`, and nothing below changes.

**Principals** are opaque tokens — `user:<id>`, `entity:<id>` (typically a `person`), `group:<id>`, `service:<name>`, and `world` — built with the exported helpers `principalUser`, `principalEntity`, `principalGroup`, `principalService`, and `PRINCIPAL_WORLD`. (`parsePrincipal(token)` parses one back; an unknown prefix is `kind: 'unknown'`, never `world`.)

**Grant** access with an `acl` on any entity or fact:

```typescript
import { principalEntity } from '@everworker/oneringai';

await memory.addFact(
  {
    subjectId: deal.id,
    predicate: 'note',
    kind: 'atomic',
    details: 'Pricing discussed with Alice',
    permissions: { group: 'none', world: 'none' },              // owner-private base
    acl: [{ principal: principalEntity('alice'), actions: ['read'] }],  // …plus Alice
  },
  { userId: 'owner', groupId: 'g1' },
);
```

`ACLEntry` is `{ principal, actions: Array<'read' | 'write'> }`; an empty `actions` array grants nothing (never a silent read). On every write the storage boundary projects `ownerId` + `groupId` + `permissions` + `acl` into two **library-owned** arrays on the record — `readPrincipals` and `writePrincipals` (`writePrincipals ⊆ readPrincipals`). Never set these by hand; they're recomputed on each write.

**Query in principal mode** by passing `scope.principals` — its *presence* (any length) is authoritative, and a record is visible iff the token sets intersect:

```typescript
import { principalUser, principalGroup, principalEntity, PRINCIPAL_WORLD } from '@everworker/oneringai';

const scope = {
  principals: [
    principalUser('alice'),            // own user token → owner access
    principalGroup('g1'),              // groups alice belongs to
    principalEntity(alicePersonId),    // alice's Person entity (account-link grants)
    PRINCIPAL_WORLD,                   // see public records
  ],
};
await memory.getFact(id, scope);       // visible iff tokens ∩ readPrincipals ≠ ∅
```

- **Empty set** (`{ principals: [] }`) → sees/authorizes nothing. **Absent** → the legacy owner/group/world path runs unchanged.
- When present, `userId` / `groupId` are ignored for the access decision — encode them as tokens instead.
- The **host owns token-set correctness** (the library trusts it like `scope.userId`): include `PRINCIPAL_WORLD` to see public records and the caller's own `user:<id>` for owner access (both fail *closed* if omitted), and include **only** `group:` tokens the caller truly belongs to (over-including one **leaks** that group — fails *open*).

**Mutate access** after creation with `setAccess` (requires `write`; replaces the `acl` and re-materializes the arrays — it does not touch `ownerId` or the `permissions` block):

```typescript
await memory.setAccess('fact', factId, [{ principal: principalEntity('bob'), actions: ['read'] }], scope);
```

**"Account links later."** When two `person` entities turn out to be the same identity, `mergeEntities(winner, loser, scope)` rewrites every `entity:<loser>` grant to `entity:<winner>` across all records — so a linked contact's prior facts stay visible under the surviving identity.

> ⚠️ **Migration gate.** Principal callers have **no legacy fallback**: a row written before the principal model (no `readPrincipals`) is invisible to a `scope.principals` caller. Before any host code starts passing `scope.principals`, run the idempotent backfill to completion:
> ```typescript
> await memory.backfillAccessPrincipals(scope, { batchSize: 500 });
> // → { entitiesScanned, entitiesUpdated, factsScanned, factsUpdated }
> ```

The same primitives (`materializePrincipals`, `fromLibraryPermissions`, `fromNimbleAudit`, `readFilterForPrincipals`, …) are exported so a host can authorize its **own** collections with identical grammar. Full reference: [docs/MEMORY_PERMISSIONS.md § Principal-based ACLs](./docs/MEMORY_PERMISSIONS.md#principal-based-acls-explicit-grants).

### Security invariants

The library trusts scope (`{userId, groupId}`) because the host authenticates the caller. The plugin + tools preserve that trust boundary:

- **`userId` and `groupId` come from plugin config, NEVER from tool arguments.** Tools silently ignore any `groupId` passed by the LLM. (Otherwise a user in group A could ask the agent to call `memory_remember({..., groupId: "B"})` and escalate.)
- **No ghost-writes.** `memory_remember` and `memory_link` reject writes whose subject is owned by another user — the memory layer enforces `fact.ownerId == subject.ownerId`, so without this guard a write against someone else's entity would silently attribute the fact to *them*. The tools return a structured error; the LLM should `memory_upsert_entity` its own entity instead.
- **`contextIds` fail-safe restriction.** A write specifying `contextIds` that include foreign-owned or unverifiable entities is forced to owner-only whenever the host policy could otherwise choose wider visibility. The response includes a warning. This prevents planting cross-owner facts that surface in another owner's graph walks.
- **Numeric clamping.** All LLM-controllable numeric limits are capped (`maxDepth ≤ 5`, `topK ≤ 100`, `limit ≤ 200/500`, `topFactsLimit ≤ 100`, `neighborDepth ≤ 5`, `confidence`/`importance` ∈ [0, 1]). DoS and ranking-pollution mitigated.
- **`kind` is a strict enum.** Every fact is `'atomic'` or `'document'`. Anything else is rejected at both the tool and `MemorySystem.addFact` boundary.
- **`value` and `objectId` are mutually exclusive.** Either relational or attribute, never both.

### Using the tools without the plugin

If you want the LLM tools but not the plugin's profile injection (e.g. you already have a custom system prompt strategy), call the factories directly. All three share the same `CreateMemoryToolsArgs`:

```typescript
import {
  createMemoryReadTools,
  createMemoryWriteTools,
  createMemoryTools,            // convenience: all 12
} from '@everworker/oneringai';

const readTools = createMemoryReadTools({
  memory,                                   // MemorySystem instance
  agentId: 'my-agent',
  defaultUserId: 'alice',                   // fallback when ToolContext.userId is unset
  defaultGroupId: 'team-A',                 // TRUSTED — from your auth layer
  defaultPrincipals: ['user:alice', 'group:team-A', 'world'],
  // Optional: wire "me" / "this_agent" token resolution via your own bootstrap.
  getOwnSubjectIds: () => ({ userEntityId, agentEntityId }),
  autoResolveThreshold: 0.9,
});

agent.tools.registerMany(readTools);

// Or full read+write:
const writeTools = createMemoryWriteTools({ memory, agentId: 'my-agent', defaultUserId: 'alice' });
agent.tools.registerMany(writeTools);
```

Without `getOwnSubjectIds`, the `"me"` / `"this_agent"` `SubjectRef` tokens return a structured error; callers must reference entities by id, identifier, or surface.

### Direct `MemorySystem` access

For server-side code (jobs, migrations, CLI tooling) you can bypass the agent layer entirely and use the `MemorySystem` API directly:

```typescript
const scope = { userId: 'alice', groupId: 'team-A' };

// Upsert an entity
const { entity: john } = await memory.upsertEntity({
  type: 'person',
  displayName: 'John Doe',
  identifiers: [{ kind: 'email', value: 'john@acme.com' }],
}, scope);

// Add a fact
await memory.addFact({
  subjectId: john.id,
  predicate: 'works_at',
  kind: 'atomic',
  objectId: acmeId,
  importance: 0.8,
}, scope);

// Brain-like retrieval — profile + top facts + related tasks + related events
const view = await memory.getContext(john.id, {}, scope);

// Surface-form lookup (for callers that don't know the id yet)
const candidates = await memory.resolveEntity(
  { surface: 'John from Acme', type: 'person' },
  scope,
);

// Graph traversal
const neighborhood = await memory.traverse(john.id, {
  direction: 'out',
  maxDepth: 2,
}, scope);

// Semantic search (requires embedder)
const hits = await memory.semanticSearch('budget concerns', {}, scope);

// Bitemporal — what did we know about this entity on a specific date?
const past = await memory.getContext(john.id, { asOf: new Date('2026-01-15') }, scope);
```

Full API reference: [docs/MEMORY_API.md](./docs/MEMORY_API.md).

---

## Tool Catalog: Dynamic Tool Loading/Unloading

When agents need 100+ tools, sending all tool definitions to the LLM wastes tokens and degrades performance. The Tool Catalog lets agents dynamically discover and load only the tool categories they need.

### Quick Start

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [readFile, writeFile],  // always-on tools (outside catalog)
  identities: [{ connector: 'github' }],  // connector scope
  context: {
    features: { toolCatalog: true },
    toolCategories: ['web', 'code'],  // built-in category scope
    plugins: {
      toolCatalog: {
        pinned: ['web'],  // always loaded, LLM can't unload
      },
    },
  },
});
```

The agent gets 3 metatools: `tool_catalog_search`, `tool_catalog_load`, `tool_catalog_unload`. It can browse available categories, load what it needs, and unload when done.

**Important:** Plugin tools (memory, context, instructions, etc.) are always available and completely separate from the catalog. They cannot be unloaded.

### How Scoping Works

The Tool Catalog has two independent scoping mechanisms:

| Scope | Controls | Config |
|-------|----------|--------|
| **`toolCategories`** | Built-in categories (filesystem, web, code, shell, etc.) | `context.toolCategories` |
| **`identities`** | Connector categories (connector:github, connector:slack, etc.) | `Agent.create({ identities })` |

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',

  // Controls which connector categories appear in catalog
  identities: [
    { connector: 'github' },
    { connector: 'slack' },
    { connector: 'microsoft', accountId: 'work' },
  ],

  context: {
    features: { toolCatalog: true },
    // Controls which built-in categories appear in catalog
    toolCategories: ['filesystem', 'web', 'code'],
  },
});

// LLM sees: filesystem, web, code, connector:github, connector:slack, connector:microsoft:work
```

**Scoping syntax for `toolCategories`:**

```text
// Allowlist (string[] shorthand)
toolCategories: ['web', 'knowledge']

// Explicit allowlist
toolCategories: { include: ['web', 'knowledge'] }

// Blocklist (all except these)
toolCategories: { exclude: ['desktop', 'shell'] }

// No scope = all built-in categories visible
```

### Pinned Categories

Pinned categories are always loaded and the LLM cannot unload them. Use this for tools the agent must always have access to:

```typescript
const contextConfig = {
  features: { toolCatalog: true },
  toolCategories: ['filesystem', 'web', 'code'],
  plugins: {
    toolCatalog: {
      pinned: ['filesystem'],  // always loaded, can't unload
    },
  },
};
```

**Pinned vs always-on tools (`tools` array):**
- `tools: [myTool]` on `Agent.create()` — individual tools always available, outside the catalog entirely
- `pinned: ['filesystem']` — entire category loaded via catalog, visible in catalog listings as `[PINNED]`, but cannot be unloaded

**Behavior:**
- Pinned categories are loaded automatically when the plugin initializes
- `tool_catalog_unload` returns an error for pinned categories
- Pinned categories don't count toward `maxLoadedCategories` limit
- During compaction, pinned categories are never evicted

### Auto-Loading Categories

Pre-load categories so the agent doesn't need an extra turn. Unlike pinned, auto-loaded categories **can** be unloaded by the LLM:

```typescript
const pluginConfigs = {
  plugins: {
  toolCatalog: {
    pinned: ['filesystem'],                     // always loaded
    autoLoadCategories: ['web', 'knowledge'],   // pre-loaded, can be unloaded
    maxLoadedCategories: 10,                    // limit (excludes pinned)
  },
  },
};
```

### Dynamic Instructions

The LLM receives dynamic instructions that list exactly which categories are available, with markers:

```
## Tool Catalog

Your core tools (memory, context, instructions, etc.) are always available.
Additional tool categories can be loaded on demand from the catalog below.

**Available categories:**
- filesystem (6 tools) [PINNED]: Read, write, edit, search, and list files
- web (1 tool): Fetch and process web content
- code (1 tool): Execute JavaScript code in sandboxed VM
- connector:github (9 tools): Authenticated API + 8 GitHub tools
- connector:slack (11 tools): Authenticated API + 10 Slack tools

**Best practices:**
- Search first to find the right category before loading.
- Unload categories you no longer need to keep context lean.
- Categories marked [PINNED] are always available and cannot be unloaded.
```

### ToolCatalogRegistry

Static global registry for tool categories (like `Connector` and `StorageRegistry`). Register your custom categories at app startup:

```typescript
import { ToolCatalogRegistry } from '@everworker/oneringai';

ToolCatalogRegistry.registerCategory({
  name: 'knowledge',
  displayName: 'Knowledge Graph',
  description: 'Search entities, get facts, manage references',
});

ToolCatalogRegistry.registerTools('knowledge', [
  { name: 'entity_search', displayName: 'Entity Search', description: 'Search people/orgs', tool: entitySearch, safeByDefault: true },
]);
```

Built-in tools from `registry.generated.ts` are auto-registered on first access.

### Resolving Tool Names

For executors that resolve `string[]` tool names to `ToolFunction[]`:

```typescript
const tools = ToolCatalogRegistry.resolveTools(
  ['entity_search', 'github_api'],
  { includeConnectors: true }
);
```

### Tools

| Tool | Description | Permission |
|------|-------------|------------|
| `tool_catalog_search` | Browse categories, list tools, keyword search | Always allowed |
| `tool_catalog_load` | Load a category's tools into the agent | Always allowed |
| `tool_catalog_unload` | Unload a category to free token budget | Always allowed |

### Full Configuration Reference

```typescript
interface ToolCatalogPluginConfig {
  /** Scope for built-in categories (does NOT affect connector categories) */
  categoryScope?: string[] | { include: string[] } | { exclude: string[] };
  /** Categories pre-loaded on init (can be unloaded by LLM) */
  autoLoadCategories?: string[];
  /** Categories always loaded (cannot be unloaded by LLM) */
  pinned?: string[];
  /** Max loaded categories at once, excluding pinned (default: 10) */
  maxLoadedCategories?: number;
  /** Auth identities for connector filtering (usually set via Agent.create) */
  identities?: AuthIdentity[];
}
```

---

## Routine Execution

Execute multi-step workflows where an AI agent runs tasks in dependency order, validates completion via LLM self-reflection, and uses memory as the bridge between tasks.

### Overview

The **Routine Runner** (`executeRoutine()`) takes a `RoutineDefinition` and executes it end-to-end:

1. Creates an Agent with working memory + in-context memory enabled
2. Runs tasks in dependency order (respecting `dependsOn`)
3. After each task, validates completion using LLM self-reflection against criteria
4. Clears conversation between tasks but **preserves memory plugins** — this is how tasks share data
5. Retries failed tasks up to `maxAttempts`
6. Returns a `RoutineExecution` with status, progress, and per-task results

```
Task A → validate → clear conversation → Task B → validate → clear → Task C → done
           ↓                                ↓
    memory persists ──────────────→ memory persists
```

### Quick Start

```typescript
import {
  Connector, Vendor, executeRoutine,
  createRoutineDefinition,
} from '@everworker/oneringai';

// 1. Setup connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// 2. Define a routine
const routine = createRoutineDefinition({
  name: 'Research Report',
  description: 'Research a topic and write a report',
  instructions: 'You are a research assistant. Be thorough and cite sources.',
  tasks: [
    {
      name: 'Research',
      description: 'Search for information about quantum computing advances in 2026',
      expectedOutput: 'A summary of key findings stored in memory',
      suggestedTools: ['web_search', 'web_fetch'],
      validation: {
        completionCriteria: [
          'At least 3 distinct sources were found',
          'Key findings were stored in memory',
        ],
      },
    },
    {
      name: 'Write Report',
      description: 'Write a structured report based on the research findings',
      expectedOutput: 'A markdown report with introduction, findings, and conclusion',
      dependsOn: ['Research'],
      validation: {
        completionCriteria: [
          'Report has an introduction, findings section, and conclusion',
          'Report cites specific sources from the research',
        ],
      },
    },
  ],
});

// 3. Execute
const execution = await executeRoutine({
  definition: routine,
  connector: 'openai',
  model: 'gpt-4.1',
  onTaskComplete: (task) => console.log(`Done: ${task.name}`),
  onTaskFailed: (task) => console.error(`Failed: ${task.name}`),
});

console.log(execution.status);   // 'completed' | 'failed'
console.log(execution.progress); // 100
```

### RoutineDefinition Structure

```typescript
interface RoutineDefinition {
  name: string;                    // Routine name
  description: string;             // Human-readable description (required)
  instructions?: string;           // System prompt for the agent
  requiredTools?: string[];        // Tool names that must be available
  requiredPlugins?: string[];      // Plugin names that must be registered

  tasks: TaskInput[];              // Array of task definitions (TaskDefinition does not exist)

  concurrency?: {
    maxParallelTasks: number;      // Required if concurrency is set; runner executes tasks sequentially regardless
    strategy: 'fifo' | 'priority' | 'shortest-first';
    failureMode?: 'fail-fast' | 'continue' | 'fail-all';  // Default: 'fail-fast'
  };
}
```

### Task Definition

Each task in a routine has:

```typescript
interface TaskInput {
  name: string;                    // Task name (used as ID)
  description: string;             // What the agent should do
  expectedOutput?: string;         // What success looks like
  suggestedTools?: string[];       // Hint to the agent about useful tools
  dependsOn?: string[];            // Task names this depends on
  maxAttempts?: number;            // Max retry attempts (default: 3)

  validation?: {
    completionCriteria?: string[]; // Criteria for LLM self-reflection
    minCompletionScore?: number;   // Minimum score 0-100 (default: 80)
    skipReflection?: boolean;      // Skip validation, auto-pass
  };
}
```

### Control Flow (Map / Fold / Until)

Tasks can use control flow to iterate over data. Three flow types are available:

- **`map`** — Execute a sub-routine for each element in an array (from memory key)
- **`fold`** — Accumulate a result across array elements (like `Array.reduce`)
- **`until`** — Repeat a sub-routine until a condition is met

All three support an optional `iterationTimeoutMs` to prevent infinite hangs:

```typescript
const mapTask = {
  name: 'Process Items',
  description: 'Process each item from the list',
  controlFlow: {
    type: 'map',
    source: '__items_list',
    resultKey: '__processed_items',
    maxIterations: 50,
    iterationTimeoutMs: 120000, // 2 min per iteration
    tasks: [
      { name: 'Process', description: 'Process the current item' },
    ],
  },
};
```

When `iterationTimeoutMs` is set, each sub-execution is wrapped with `Promise.race`. If an iteration exceeds the timeout (or its sub-execution otherwise fails), the entire `map`/`fold`/`until` task fails immediately — there is no per-iteration failure mode or skip-and-continue; the loop does not proceed to remaining iterations.

### Error Classification

The routine runner classifies errors as **transient** or **permanent**:

- **Permanent errors** (auth failures, context length exceeded, model not found, config errors) immediately fail the task without retrying
- **Transient errors** (network issues, rate limits, unknown errors) are retried up to `maxAttempts`

This prevents wasting retries on errors that will never succeed.

### `ROUTINE_KEYS` Constant

The `ROUTINE_KEYS` constant is exported from the core library and contains all well-known ICM/WM key names used internally by the routine framework:

```typescript
import { ROUTINE_KEYS } from '@everworker/oneringai';

// ROUTINE_KEYS.PLAN            → '__routine_plan'
// ROUTINE_KEYS.DEPS            → '__routine_deps'
// ROUTINE_KEYS.DEP_RESULT_PREFIX → '__dep_result_'
// ROUTINE_KEYS.MAP_ITEM        → '__map_item'
// ROUTINE_KEYS.MAP_INDEX       → '__map_index'
// ROUTINE_KEYS.MAP_TOTAL       → '__map_total'
// ROUTINE_KEYS.FOLD_ACCUMULATOR → '__fold_accumulator'
```

Useful for custom integrations that need to read or set routine state programmatically.

### Task Dependencies and Ordering

Tasks execute in dependency order. Use `dependsOn` to create a DAG:

```typescript
const routine = createRoutineDefinition({
  name: 'Data Pipeline',
  tasks: [
    { name: 'Fetch Data', description: '...' },
    { name: 'Clean Data', description: '...', dependsOn: ['Fetch Data'] },
    { name: 'Analyze', description: '...', dependsOn: ['Clean Data'] },
    { name: 'Visualize', description: '...', dependsOn: ['Analyze'] },
  ],
});
```

Tasks with no dependencies run first. A task only becomes eligible when all its dependencies are completed.

### Memory as the Inter-Task Bridge

Between tasks, conversation history is cleared but **memory plugins persist**. This is how tasks share information:

- **In-Context Memory** (`store_set("whiteboard", ...)`): Small key results that subsequent tasks see immediately in context. No retrieval call needed.
  ```
  Task 1 calls: store_set("whiteboard", "api_endpoints", { description: "...", value: "Found 3 endpoints: /users, /orders, /products" })
  Task 2 sees this automatically in its context window
  ```

- **Working Memory** (`store_set("notes", ...)` / `store_get("notes", ...)`): Larger data stored externally, retrieved on demand.
  ```
  Task 1 calls: store_set("notes", "raw_data", { description: "Full API response", value: "...", tier: "findings" })
  Task 2 calls: store_get("notes", "raw_data") → gets the full response
  ```

Note: the built-in default system prompt does not use this pattern — it still instructs the agent to use `context_set`, `memory_store` (tier="findings"), and `memory_retrieve`, none of which are registered tools. Use `prompts.system` to override it with instructions that reference the `store_set`/`store_get` tools shown above.

### Validation and Self-Reflection

After each task completes, the runner validates the output:

1. LLM validation is opt-in: it only runs when the task sets `skipReflection: false` explicitly AND provides non-empty `completionCriteria`
2. Otherwise (the default — `skipReflection` omitted/`true`, or no `completionCriteria`) the task auto-passes with `completionScore: 100`
3. When enabled: calls `agent.runDirect()` with the task criteria and agent's response
4. The validation LLM is asked to return `{ isComplete, completionScore, explanation }`, but only `completionScore`/`explanation` are used — the LLM's own `isComplete` is ignored
5. Task passes if `completionScore >= minCompletionScore` (default 80)

```typescript
const validation = {
  validation: {
    completionCriteria: [
      'All API endpoints were documented',
      'Error codes were listed for each endpoint',
      'Authentication requirements were specified',
    ],
    minCompletionScore: 85,  // Strict: require 85+ score
  },
};
```

### Retry Logic

If validation fails and the task hasn't exhausted `maxAttempts`:

- The conversation is **NOT cleared** (agent builds on previous attempt)
- Task status returns to `in_progress` (increments attempt counter)
- Agent retries with the same prompt

If `maxAttempts` is exceeded, the task is marked `failed`.

### Failure Modes

```typescript
const routine = createRoutineDefinition({
  name: 'Pipeline',
  concurrency: {
    maxParallelTasks: 1,
    strategy: 'fifo',
    failureMode: 'fail-fast',  // Default: stop on first failure
    // failureMode: 'continue', // Skip failed tasks, continue with independents
  },
  tasks: [],
});
```

| Mode | Behavior |
|------|----------|
| `fail-fast` | Stop entire routine on first task failure |
| `continue` | Skip failed task, proceed to next independent task |

### Custom Prompts

Override any prompt builder to customize agent behavior:

```typescript
const execution = await executeRoutine({
  definition: routine,
  connector: 'openai',
  model: 'gpt-4.1',
  prompts: {
    // Custom system prompt
    system: (definition) => `You are ${definition.name}. Follow these rules...`,

    // Custom task prompt
    task: (task) => `
      ## ${task.name}
      ${task.description}
      Remember to store results using store_set("whiteboard", key, { description, value }).
    `,

    // Custom validation prompt
    validation: (task, context) => `
      Did the agent complete "${task.name}"?
      Criteria: ${task.validation?.completionCriteria?.join(', ')}
      Response: ${context.responseText}
      Return JSON: { "isComplete": boolean, "completionScore": number, "explanation": string }
    `,
  },
});
```

### Callbacks and Progress Tracking

```typescript
const execution = await executeRoutine({
  definition: routine,
  connector: 'openai',
  model: 'gpt-4.1',

  onTaskComplete: (task, execution) => {
    console.log(`Task "${task.name}" completed`);
    console.log(`  Score: ${task.result?.validationScore}`);
    console.log(`  Progress: ${execution.progress}%`);
  },

  onTaskFailed: (task, execution) => {
    console.error(`Task "${task.name}" failed after ${task.attempts} attempts`);
    console.error(`  Error: ${task.result?.error}`);
  },
});
```

### ExecuteRoutineOptions Reference

```typescript
interface ExecuteRoutineOptions {
  /** Routine definition to execute */
  definition: RoutineDefinition;

  /** Pre-created Agent instance. When provided, connector/model/tools are ignored.
   *  The agent is NOT destroyed after execution — caller manages its lifecycle. */
  agent?: Agent;

  /** Connector name — required when `agent` is not provided */
  connector?: string;

  /** Model ID — required when `agent` is not provided */
  model?: string;

  /** Additional tools — only used when creating a new agent (no `agent` provided) */
  tools?: ToolFunction[];

  /** Input parameter values for parameterized routines */
  inputs?: Record<string, unknown>;

  /** Hooks — applied to agent for the duration of routine execution */
  hooks?: HookConfig;

  /** Called when a task starts executing */
  onTaskStarted?: (task: Task, execution: RoutineExecution) => void;

  /** Called when a task completes successfully */
  onTaskComplete?: (task: Task, execution: RoutineExecution) => void;

  /** Called when a task fails */
  onTaskFailed?: (task: Task, execution: RoutineExecution) => void;

  /** Called after each validation attempt (whether pass or fail) */
  onTaskValidation?: (task: Task, result: TaskValidationResult, execution: RoutineExecution) => void;

  /** Configurable prompts (all have sensible defaults) */
  prompts?: {
    system?: (definition: RoutineDefinition) => string;
    task?: (task: Task) => string;
    validation?: (task: Task, context: ValidationContext) => string;
  };
}
```

### RoutineExecution Result

```typescript
interface RoutineExecution {
  id: string;                      // Unique execution ID
  routineId: string;               // From definition
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  plan: Plan;                      // Tasks with statuses and results
  progress: number;                // 0-100 percentage
  startedAt?: number;              // Timestamp
  completedAt?: number;            // Timestamp
  lastUpdatedAt: number;           // Timestamp
  error?: string;                  // Error message if failed
}
```

Each completed task has a `result`:

```typescript
// Shape of Task.result (not a separately exported type)
interface TaskResult {
  success: boolean;
  output?: unknown;                // Agent's response text (or control-flow result)
  error?: string;                  // Error message if failed
  validationScore?: number;        // 0-100 from validation
  validationExplanation?: string;  // Why it passed/failed
}
```

### Complete Example: Multi-Step Research Pipeline

```typescript
import {
  Connector, Vendor, Agent,
  executeRoutine, createRoutineDefinition,
  ConnectorTools, Services, tools,
} from '@everworker/oneringai';

// Setup connectors
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

Connector.create({
  name: 'serper',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

// Define the routine
const routine = createRoutineDefinition({
  name: 'Competitive Analysis',
  description: 'Analyze competitors and produce a report',
  instructions: 'You are a business analyst. Be thorough and data-driven.',
  requiredTools: ['web_search'],
  tasks: [
    {
      name: 'Identify Competitors',
      description: 'Search for the top 5 competitors of Acme Corp in the cloud storage market',
      expectedOutput: 'List of competitors stored in context',
      suggestedTools: ['web_search'],
      validation: {
        completionCriteria: [
          'At least 5 competitors were identified',
          'Competitor names were stored using store_set("whiteboard", ...)',
        ],
      },
    },
    {
      name: 'Analyze Features',
      description: 'For each competitor found, research their key features and pricing',
      dependsOn: ['Identify Competitors'],
      expectedOutput: 'Feature comparison data stored in memory',
      suggestedTools: ['web_search', 'web_fetch'],
      maxAttempts: 2,
      validation: {
        completionCriteria: [
          'Features were researched for all identified competitors',
          'Pricing information was found for at least 3 competitors',
          'Data was stored in working memory',
        ],
        minCompletionScore: 70,  // More lenient — pricing may not always be public
      },
    },
    {
      name: 'Write Report',
      description: 'Compile findings into a structured competitive analysis report',
      dependsOn: ['Analyze Features'],
      expectedOutput: 'A markdown report with executive summary, feature comparison table, and recommendations',
      validation: {
        completionCriteria: [
          'Report has an executive summary',
          'Report includes a feature comparison table',
          'Report provides actionable recommendations',
        ],
      },
    },
  ],
});

// Execute with search tools
const searchTools = ConnectorTools.for('serper');

const execution = await executeRoutine({
  definition: routine,
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [...searchTools, tools.webFetch],
  onTaskComplete: (task, exec) => {
    console.log(`[${exec.progress}%] ${task.name} completed (score: ${task.result?.validationScore})`);
  },
  onTaskFailed: (task) => {
    console.error(`FAILED: ${task.name} — ${task.result?.error}`);
  },
});

if (execution.status === 'completed') {
  // Get the final report from the last task's output
  const reportTask = execution.plan.tasks.find(t => t.name === 'Write Report');
  console.log(reportTask?.result?.output);
} else {
  console.error(`Routine failed: ${execution.error}`);
}
```

### Best Practices

1. **Use `store_set("whiteboard", ...)` for small shared state** — task names, IDs, short summaries. These are always visible.
2. **Use `store_set("notes", ...)` for large data** — full API responses, documents, raw data. Retrieved on demand via `store_get("notes", key)`.
3. **Define clear completion criteria** — specific, verifiable conditions the LLM can evaluate.
4. **Set appropriate `minCompletionScore`** — use 80+ for strict validation, 60-70 for lenient.
5. **Use `skipReflection: true`** for simple tasks that don't need validation.
6. **Keep `maxAttempts` reasonable** — 2-3 for most tasks. Each retry costs LLM calls.
7. **Use `continue` failure mode** when tasks are independent and partial results are acceptable.

### Routine Persistence

Save routine definitions to disk and load them later using `FileRoutineDefinitionStorage` (or implement `IRoutineDefinitionStorage` for custom backends like MongoDB).

```typescript
import {
  createFileRoutineDefinitionStorage,
  createRoutineDefinition,
} from '@everworker/oneringai';

const storage = createFileRoutineDefinitionStorage();

// Save a routine
const routine = createRoutineDefinition({
  name: 'Daily Report',
  description: 'Generate a daily status report',
  tags: ['daily', 'reports'],
  author: 'alice',
  tasks: [
    { name: 'Gather Data', description: 'Collect metrics from all sources' },
    { name: 'Write Report', description: 'Summarize findings', dependsOn: ['Gather Data'] },
  ],
});

await storage.save(undefined, routine);  // undefined = default user

// Load by ID
const loaded = await storage.load(undefined, routine.id);

// List with filtering
const dailyRoutines = await storage.list(undefined, { tags: ['daily'] });
const searchResults = await storage.list(undefined, { search: 'report', limit: 10 });

// Delete
await storage.delete(undefined, routine.id);
```

**Storage Path:** `~/.oneringai/users/<userId>/routines/<id>.json` (defaults to `~/.oneringai/users/default/routines/`)

**Multi-user isolation:** Pass a `userId` to isolate routines per user. When `userId` is `undefined`, defaults to `'default'`.

**StorageRegistry integration:**

```typescript
import { StorageRegistry } from '@everworker/oneringai';

StorageRegistry.configure({
  routineDefinitions: (ctx) => new MongoRoutineStorage(ctx?.userId),
});
```

### Execution Recording

Persist full routine execution history — every step, task snapshot, and progress update — without manually wiring hooks and callbacks.

**Types:**

| Type | Purpose |
|------|---------|
| `RoutineExecutionRecord` | Top-level persisted record (status, progress, tasks, steps, trigger info) |
| `RoutineTaskSnapshot` | Per-task snapshot (status, attempts, result, controlFlowType) |
| `RoutineExecutionStep` | Timestamped event (task.started, tool.call, llm.complete, etc.) |
| `RoutineTaskResult` | Task outcome (success, output, error, validationScore) |

**Factory functions:**

```typescript
import {
  createRoutineExecutionRecord,
  createTaskSnapshots,
  createExecutionRecorder,
} from '@everworker/oneringai';

// 1. Create the initial record from a definition
const record = createRoutineExecutionRecord(definition, 'openai', 'gpt-4.1', {
  type: 'schedule',
  source: 'daily-cron',
});

// 2. Insert into your storage backend
const execId = await storage.insert(userId, record);

// 3. Create recorder — returns ready-to-use hooks + callbacks
const recorder = createExecutionRecorder({
  storage,
  executionId: execId,
  logPrefix: '[MyRoutine]',
  maxTruncateLength: 500,  // truncate tool args/results in steps
});

// 4. Wire into executeRoutine()
executeRoutine({
  definition, agent, inputs,
  hooks: recorder.hooks,
  onTaskStarted: recorder.onTaskStarted,
  onTaskComplete: recorder.onTaskComplete,
  onTaskFailed: recorder.onTaskFailed,
  onTaskValidation: recorder.onTaskValidation,
})
  .then(exec => recorder.finalize(exec))
  .catch(err => recorder.finalize(null, err));
```

**What the recorder tracks:**

| Hook/Callback | Step Type(s) |
|--------------|-------------|
| `before:llm` | `llm.start` |
| `after:llm` | `llm.complete` (with duration/tokens) |
| `before:tool` | `tool.start` |
| `after:tool` | `tool.call` (with args/result, truncated) |
| `after:execution` | `iteration.complete` |
| `pause:check` | heartbeat (`lastActivityAt` update) |
| `onTaskStarted` | `task.started`, `control_flow.started` |
| `onTaskComplete` | `task.completed`, `control_flow.completed` |
| `onTaskFailed` | `task.failed` |
| `onTaskValidation` | `task.validation` |
| `finalize` | `execution.error` (on failure), final status update |

**Storage interface (`IRoutineExecutionStorage`):**

```typescript
interface IRoutineExecutionStorage {
  insert(userId: string | undefined, record: RoutineExecutionRecord): Promise<string>;
  update(id: string, updates: Partial<Pick<RoutineExecutionRecord, 'status' | 'progress' | 'error' | 'completedAt' | 'lastActivityAt'>>): Promise<void>;
  pushStep(id: string, step: RoutineExecutionStep): Promise<void>;
  updateTask(id: string, taskName: string, updates: Partial<RoutineTaskSnapshot>): Promise<void>;
  load(id: string): Promise<RoutineExecutionRecord | null>;
  list(userId: string | undefined, options?: { routineId?: string; status?: RoutineExecutionStatus; limit?: number; offset?: number }): Promise<RoutineExecutionRecord[]>;
  hasRunning(userId: string | undefined, routineId: string): Promise<boolean>;
}
```

Implement this interface for your own storage backend (MongoDB, PostgreSQL, etc.), or use the library's built-in `FileRoutineExecutionStorage` (`createFileRoutineExecutionStorage()`), which persists records to `~/.oneringai/users/<userId>/routine-executions/<executionId>.json`.

**StorageRegistry integration:**

```typescript
StorageRegistry.configure({
  routineExecutions: (ctx) => new MongoRoutineExecutionStorage(ctx?.userId),
});
```

### Scheduling

Run routines on a timer using `IScheduler`. The built-in `SimpleScheduler` supports interval and one-time schedules:

```typescript
import { SimpleScheduler } from '@everworker/oneringai';

const scheduler = new SimpleScheduler();

// Repeat every hour
scheduler.schedule('hourly-report', { intervalMs: 3600000 }, async () => {
  await executeRoutine({ definition: dailyRoutine, agent, inputs });
});

// Run once at a specific time
scheduler.schedule('end-of-day', { once: endOfDayTimestamp }, async () => {
  await executeRoutine({ definition: summaryRoutine, agent, inputs });
});

// Cancel a schedule
scheduler.cancel('hourly-report');

// Check if a schedule exists
scheduler.has('hourly-report'); // false

// Clean up all timers
scheduler.destroy();
```

**`ScheduleSpec` options:**

| Field | Type | Description |
|-------|------|-------------|
| `intervalMs` | `number` | Repeat every N milliseconds |
| `once` | `number` | Fire once at this Unix timestamp (ms) |
| `cron` | `string` | Cron expression (not supported by `SimpleScheduler` — use a cron library) |
| `timezone` | `string` | IANA timezone for cron expressions |

**SimpleScheduler** is intentionally minimal. For cron support, implement `IScheduler` with a cron library (e.g., `croner`, `node-cron`):

```typescript
import type { IScheduler, ScheduleHandle, ScheduleSpec } from '@everworker/oneringai';
import { Cron } from 'croner';

class CronScheduler implements IScheduler {
  private jobs = new Map<string, Cron>();
  private _isDestroyed = false;

  schedule(id: string, spec: ScheduleSpec, callback: () => void | Promise<void>): ScheduleHandle {
    if (spec.cron) {
      const job = new Cron(spec.cron, { timezone: spec.timezone }, callback);
      this.jobs.set(id, job);
      return { id, cancel: () => this.cancel(id) };
    }
    throw new Error('CronScheduler only handles cron specs');
  }
  cancel(id: string) { this.jobs.get(id)?.stop(); this.jobs.delete(id); }
  cancelAll() { for (const [id] of this.jobs) this.cancel(id); }
  has(id: string) { return this.jobs.has(id); }
  destroy() { this.cancelAll(); this._isDestroyed = true; }
  get isDestroyed() { return this._isDestroyed; }
}
```

### Event Triggers

Trigger routine execution from external events (webhooks, message queues, custom signals) using `EventEmitterTrigger`:

```typescript
import { EventEmitterTrigger } from '@everworker/oneringai';

const trigger = new EventEmitterTrigger();

// Register a handler
const unsubscribe = trigger.on('new-order', async (payload) => {
  const order = payload as { orderId: string; items: string[] };
  await executeRoutine({
    definition: orderProcessingRoutine,
    agent,
    inputs: { orderId: order.orderId, items: order.items },
  });
});

// Emit from your webhook handler, queue consumer, etc.
app.post('/webhooks/orders', (req, res) => {
  trigger.emit('new-order', req.body);
  res.sendStatus(200);
});

// Unsubscribe a specific handler
unsubscribe();

// Clean up all listeners
trigger.destroy();
```

**Key design:** `EventEmitterTrigger` is intentionally simple — no `ITriggerSource` interface. For complex trigger systems (AWS SQS, RabbitMQ, Kafka), just call `trigger.emit()` from your consumer callback.

---

## Tools & Function Calling

### Defining Tools

```typescript
import { ToolFunction } from '@everworker/oneringai';

const weatherTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name, e.g., "San Francisco"',
          },
          units: {
            type: 'string',
            enum: ['celsius', 'fahrenheit'],
            description: 'Temperature units',
          },
        },
        required: ['location'],
      },
    },
  },
  execute: async (args) => {
    // Your implementation
    const { location, units = 'fahrenheit' } = args;

    // Call weather API
    const temp = 72; // Example

    return {
      location,
      temperature: temp,
      units,
      conditions: 'sunny',
    };
  },
};
```

### Using Tools

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool, calculatorTool, searchTool],
});

const response = await agent.run('What is the weather in Paris?');

// Agent will:
// 1. Recognize it needs weather data
// 2. Call weatherTool with { location: "Paris" }
// 3. Receive result
// 4. Generate natural language response

console.log(response.output_text);
// "The current weather in Paris is 72°F and sunny."
```

### Tool Management

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tool1, tool2],
});

// Add a tool
agent.addTool(newTool);

// Remove a tool
agent.removeTool('tool_name');

// Replace all tools
agent.setTools([tool1, tool2, tool3]);

// List available tools
const toolNames = agent.listTools();
console.log(toolNames); // ['get_weather', 'calculate', 'search']
```

### Tool Execution Context

Tools receive a context object with useful information:

```typescript
const myTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: 'Example tool',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      },
    },
  },
  execute: async (args, context) => {
    // Identity (auto-populated from agent config):
    console.log(context?.agentId);  // Agent identifier
    console.log(context?.userId);   // User ID (set via agent.userId or config)

    // Connector registry (scoped to agent's userId + identities):
    if (context?.connectorRegistry) {
      const names = context.connectorRegistry.list();  // Available connector names
      const gh = context.connectorRegistry.get('github'); // Get connector instance
    }

    // Working memory (when workingMemory feature is enabled):
    if (context?.memory) {
      const data = await context.memory.get('some_key');
    }

    // Cancellation:
    if (context?.signal?.aborted) {
      return { error: 'Cancelled' };
    }

    return { result: 'done' };
  },
};
```

### Built-in Tools Overview

Tool counts are deliberately not presented as one fixed headline number: 39
connector-free tools live in the generated registry, while context plugins,
configured connectors, MCP servers, and the orchestrator add tools at runtime.

| Source | Registration model |
|--------|--------------------|
| Generated built-ins | `ToolRegistry.getBuiltInTools()`; stable connector-free registry |
| Context plugins | Enabled by `context.features` (`store_*`, `memory_*`, catalog, TODO tools) |
| Connector tools | Created from live connectors by `ConnectorTools.for()` / `discoverAll()` |
| Application and MCP tools | Supplied by the host or discovered from connected MCP servers |

The complete source-of-truth inventory is in the
[Connector & Tool Catalog](./docs/CONNECTOR_TOOL_CATALOG.md).

| Category | Tools | Description |
|----------|-------|-------------|
| **Unified Store** | `store_get`, `store_set`, `store_delete`, `store_list`, `store_action` | Generic CRUD for all plugin stores: memory, context, instructions, user_info, workspace (auto-registered) |
| **Filesystem** | `read_file`, `write_file`, `edit_file`, `glob`, `grep`, `list_directory` | Local file operations |
| **Shell** | `bash`, `bg_process_kill`, `bg_process_list`, `bg_process_output`, `dev_server` | Shell command execution, background process management, and dev server orchestration |
| **Web** | `web_fetch` (built-in), `web_search` / `web_scrape` (ConnectorTools) | Web content retrieval, search, and scraping |
| **Desktop** | `desktop_screenshot`, `desktop_mouse_*`, `desktop_keyboard_*`, `desktop_window_*`, `desktop_get_*` | OS-level desktop automation (11 tools, requires `@nut-tree-fork/nut-js`) |
| **Code** | `execute_javascript` | Sandboxed JavaScript execution |
| **JSON** | `json_manipulate` | JSON object manipulation (add, delete, replace fields) |
| **Custom tools** | `custom_tool_draft`, `custom_tool_test`, `custom_tool_save`, `custom_tool_load`, `custom_tool_list`, `custom_tool_delete` | Let agents create, test, persist, and reuse sandboxed tools |
| **Routines** | `generate_routine`, `routine_get/list/update/delete`, task-step tools, execution listing | Build and manage persisted multi-step routines (8 tools) |
| **GitHub** | `search_files`, `search_code`, `read_file`, `list_branches`, `get_pr`, `pr_files`, `pr_comments`, `create_pr` | GitHub API operations (8 tools, auto-registered for GitHub connectors) |
| **Slack** | Channel, message, thread, search, mention, reaction, and user tools | Slack API operations (10 tools, auto-registered) |
| **Microsoft** | `create_draft_email`, `send_email`, `create_meeting`, `edit_meeting`, `get_meeting`, `list_meetings`, `find_meeting_slots`, `get_meeting_transcript`, `read_file`, `list_files`, `search_files` | Microsoft Graph tools (11 tools, auto-registered) |
| **Google** | `create_draft_email`, `send_email`, `create_meeting`, `edit_meeting`, `get_meeting`, `list_meetings`, `find_meeting_slots`, `get_meeting_transcript`, `read_file`, `list_files`, `search_files` | Google Workspace tools (11 tools, auto-registered) |
| **Zoom** | `zoom_create_meeting`, `zoom_update_meeting`, `zoom_get_transcript` | Zoom meeting tools (3 tools, auto-registered) |
| **Telegram** | `telegram_send_message`, `telegram_send_photo`, `telegram_get_updates`, `telegram_set_webhook`, `telegram_get_me`, `telegram_get_chat` | Telegram Bot API tools (6 tools, auto-registered) |
| **Twilio** | `send_sms`, `send_whatsapp`, `list_messages`, `get_message` | SMS and WhatsApp tools (4 tools, auto-registered) |
| **Multimedia** | `generate_image`, `generate_video`, `video_status`, `text_to_speech`, `speech_to_text` | Vendor-dependent subset auto-registered for OpenAI, Google, and xAI connectors |
| **Self-learning memory** | Six read + six write `memory_*` tools | Graph, vector, document, profile, and controlled mutation tools supplied by memory plugins |

Memory, In-Context Memory, and Persistent Instructions tools are documented in their respective sections above. Multimedia tools are documented in the Audio, Image, and Video sections. Desktop tools are documented in the Desktop Automation Tools section below. Connector-generated names are always prefixed with the actual connector name.

#### Store Tools (Memory, Context, Instructions, User Info, Workspace)

All plugin stores are accessed through the 5 unified `store_*` tools. Each store becomes available when its corresponding feature flag is enabled:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    features: {
      workingMemory: true,       // enables store="notes"
      inContextMemory: true,     // enables store="whiteboard"
      persistentInstructions: true, // enables store="instructions"
      userInfo: true,            // enables store="user_info"
      sharedWorkspace: true,     // enables store="workspace"
    },
  },
});

// The LLM uses these 5 tools to interact with all stores:
// - store_get(store, key?)       — get one entry or all
// - store_set(store, key, data)  — create/update entry
// - store_delete(store, key)     — remove entry
// - store_list(store, filter?)   — list entries
// - store_action(store, action, params?) — store-specific operations (query, clear, etc.)

// Examples:
// store_set("notes", "user.profile", { description: "User profile", value: { name: "Alice" }, priority: "high" })
// store_get("notes", "user.profile")
// store_set("whiteboard", "state", { description: "Current state", value: { step: 1 } })
// store_set("instructions", "tone", { content: "Be concise" })
// store_action("notes", "query", { tier: "findings" })

// Programmatic access (unchanged):
const memory = agent.context.memory;
await memory.store('user.profile', 'User profile', { name: 'Alice' }, 'high');
const profile = await memory.retrieve('user.profile');
```

#### Context Budget

Access context budget information via `prepare()`:

```typescript
const { input, budget } = await agent.context.prepare();

console.log(budget);
// {
//   maxTokens: 128000,
//   totalUsed: 45000,
//   available: 63800,
//   utilizationPercent: 35.2,
//   breakdown: {
//     systemPrompt: 500,
//     pluginInstructions: 800,
//     conversation: 38000,
//     currentInput: 200,
//   }
// }
```

### Code Execution Tool

```typescript
import { createExecuteJavaScriptTool } from '@everworker/oneringai';

const jsTool = createExecuteJavaScriptTool();

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [jsTool],
});

const response = await agent.run('Calculate the sum of numbers from 1 to 100');

// Agent will:
// 1. Generate JavaScript code
// 2. Execute: execute_javascript({ code: 'Array(100).fill(0).map((_, i) => i+1).reduce((a,b) => a+b)' })
// 3. Return result: 5050
```

### Custom Tool Generation

A complete meta-tool system that enables agents to **create, test, iterate, and persist their own reusable tools at runtime**. Instead of pre-defining every tool, agents can generate new tools on-the-fly based on user requests, test them in a sandboxed VM, save them to disk, and load them later — across sessions and agents.

#### Overview

| Meta-Tool | Purpose | Safe by Default |
|-----------|---------|:-:|
| `custom_tool_draft` | Validate name, schema, code syntax | Yes |
| `custom_tool_test` | Execute code in VM sandbox with test input | No |
| `custom_tool_save` | Persist to `~/.oneringai/users/<userId>/custom-tools/` | No |
| `custom_tool_list` | Search saved tools (name, description, tags, category) | Yes |
| `custom_tool_load` | Retrieve full definition including code | Yes |
| `custom_tool_delete` | Remove from storage | No |

**Additionally:**
- `hydrateCustomTool()` — Convert a saved definition into a live `ToolFunction`
- `createCustomToolMetaTools()` — Bundle factory that creates all 6 tools with shared storage

#### Quick Start

```typescript
import { Agent, Connector, Vendor, createCustomToolMetaTools } from '@everworker/oneringai';

Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Give the agent the ability to create tools
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [...createCustomToolMetaTools()],
});

// Ask the agent to create a tool
const response = await agent.run(
  'Create a tool called "celsius_to_fahrenheit" that converts temperature from Celsius to Fahrenheit'
);

// The agent will autonomously:
// 1. Call custom_tool_draft to validate the definition
// 2. Call custom_tool_test with sample inputs to verify
// 3. Call custom_tool_save to persist it
```

#### The Agent Workflow: Draft → Test → Save

When an agent has the custom tool meta-tools registered, it follows this natural workflow:

**Step 1: Draft** — The agent generates the tool definition and validates it:
```
Agent calls: custom_tool_draft({
  name: "celsius_to_fahrenheit",
  description: "Converts temperature from Celsius to Fahrenheit",
  inputSchema: {
    type: "object",
    properties: { celsius: { type: "number" } },
    required: ["celsius"]
  },
  code: "output = { fahrenheit: input.celsius * 9/5 + 32 };"
})
→ Returns: { success: true, validated: { ... } }
```

**Step 2: Test** — The agent tests the code with sample inputs:
```
Agent calls: custom_tool_test({
  code: "output = { fahrenheit: input.celsius * 9/5 + 32 };",
  inputSchema: { type: "object", properties: { celsius: { type: "number" } } },
  testInput: { celsius: 100 }
})
→ Returns: { success: true, result: { fahrenheit: 212 }, logs: [], executionTime: 3 }
```

If the test fails, the agent fixes the code and tests again — iterating until it works.

**Step 3: Save** — The agent persists the validated, tested tool:
```
Agent calls: custom_tool_save({
  name: "celsius_to_fahrenheit",
  description: "Converts temperature from Celsius to Fahrenheit",
  inputSchema: { ... },
  code: "output = { fahrenheit: input.celsius * 9/5 + 32 };",
  tags: ["conversion", "temperature"],
  category: "math"
})
→ Returns: { success: true, name: "celsius_to_fahrenheit", storagePath: "~/.oneringai/users/default/custom-tools/" }
```

#### Dynamic Descriptions & Connector Awareness

The `custom_tool_draft` and `custom_tool_test` tools use `descriptionFactory` to generate **dynamic descriptions** that include:

1. **The full VM sandbox API** — `authenticatedFetch`, `fetch`, `connectors.list()`, globals, etc.
2. **All currently registered connectors** — names, service types, base URLs, descriptions

This means the agent always knows what APIs are available when writing custom tool code. The description is **regenerated every time** tool definitions are sent to the LLM, so it stays current when connectors are added or removed.

Example of what the agent sees in the tool description:

```
SANDBOX API (available inside custom tool code):

1. authenticatedFetch(url, options, connectorName)
   Makes authenticated HTTP requests using the connector's credentials.
   Auth headers are added automatically — DO NOT set Authorization header manually.
   ...

REGISTERED CONNECTORS:
   • "github" (GitHub)
     Service: github
     URL: https://api.github.com

   • "slack" (Slack Workspace)
     Service: slack
     URL: https://slack.com/api
```

#### Creating API-Connected Tools

Because the sandbox provides `authenticatedFetch`, agents can create tools that call external APIs through registered connectors:

```typescript
// Agent creates a tool that fetches GitHub repos
// (assuming a 'github' connector is registered)
await agent.run(
  'Create a tool called "list_repos" that lists all repositories for a given GitHub user. ' +
  'Use the github connector.'
);

// The agent will write code like:
// const resp = await authenticatedFetch(`/users/${input.username}/repos`, { method: 'GET' }, 'github');
// const repos = await resp.json();
// output = repos.map(r => ({ name: r.full_name, stars: r.stargazers_count }));
```

#### Loading and Using Saved Tools

Saved tools can be loaded programmatically and used by any agent:

```typescript
import {
  createFileCustomToolStorage,
  hydrateCustomTool,
  Agent,
} from '@everworker/oneringai';

// Load a saved tool (undefined = default user)
const storage = createFileCustomToolStorage();
const definition = await storage.load(undefined, 'celsius_to_fahrenheit');

if (definition) {
  // Hydrate into a live ToolFunction
  const tool = hydrateCustomTool(definition);

  // Register on any agent
  const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1', tools: [tool] });

  // The agent can now use celsius_to_fahrenheit like any built-in tool
  const response = await agent.run('Convert 37°C to Fahrenheit');
}
```

#### Searching Saved Tools

The storage layer supports filtering and search:

```typescript
const storage = createFileCustomToolStorage();
const userId = undefined; // or a specific userId for multi-tenant apps

// List all saved tools
const all = await storage.list(userId);

// Search by name or description
const mathTools = await storage.list(userId, { search: 'convert' });

// Filter by tags
const apiTools = await storage.list(userId, { tags: ['api'] });

// Filter by category
const networkTools = await storage.list(userId, { category: 'network' });

// Pagination
const page2 = await storage.list(userId, { limit: 10, offset: 10 });
```

#### Custom Storage Backends

The default `FileCustomToolStorage` persists tools to `~/.oneringai/users/<userId>/custom-tools/` (defaults to `~/.oneringai/users/default/custom-tools/` when no userId). For production systems, implement `ICustomToolStorage` with any backend:

```typescript
import type { ICustomToolStorage, CustomToolListOptions } from '@everworker/oneringai';
import type { CustomToolDefinition, CustomToolSummary } from '@everworker/oneringai';

class MongoCustomToolStorage implements ICustomToolStorage {
  constructor(private db: Db) {}

  async save(userId: string | undefined, definition: CustomToolDefinition): Promise<void> {
    const user = userId || 'default';
    await this.db.collection('custom_tools').replaceOne(
      { userId: user, name: definition.name },
      { userId: user, ...definition },
      { upsert: true }
    );
  }

  async load(userId: string | undefined, name: string): Promise<CustomToolDefinition | null> {
    const user = userId || 'default';
    return this.db.collection('custom_tools').findOne({ userId: user, name });
  }

  async delete(userId: string | undefined, name: string): Promise<void> {
    const user = userId || 'default';
    await this.db.collection('custom_tools').deleteOne({ userId: user, name });
  }

  async exists(userId: string | undefined, name: string): Promise<boolean> {
    const user = userId || 'default';
    return (await this.db.collection('custom_tools').countDocuments({ userId: user, name })) > 0;
  }

  async list(userId: string | undefined, options?: CustomToolListOptions): Promise<CustomToolSummary[]> {
    const user = userId || 'default';
    const filter: any = { userId: user };
    if (options?.tags?.length) filter['metadata.tags'] = { $in: options.tags };
    if (options?.category) filter['metadata.category'] = options.category;
    if (options?.search) {
      filter.$or = [
        { name: { $regex: options.search, $options: 'i' } },
        { description: { $regex: options.search, $options: 'i' } },
      ];
    }

    return this.db.collection('custom_tools')
      .find(filter, { projection: { code: 0 } })  // Exclude code for summaries
      .sort({ updatedAt: -1 })
      .skip(options?.offset ?? 0)
      .limit(options?.limit ?? 100)
      .toArray();
  }

  getPath(userId: string | undefined): string { return `mongodb://custom_tools/${userId || 'default'}`; }
}

// Use with meta-tools
import { createCustomToolMetaTools } from '@everworker/oneringai';
const storage = new MongoCustomToolStorage(db);
const tools = createCustomToolMetaTools({ storage });
```

#### Sandbox API Reference

Custom tool code runs in the same VM sandbox as `execute_javascript`. Available APIs:

| API | Description |
|-----|-------------|
| `input` | The tool's input arguments (matches `inputSchema`) |
| `output` | Set this to return the tool's result |
| `authenticatedFetch(url, options, connectorName)` | Authenticated HTTP request via a registered connector |
| `fetch(url, options)` | Standard fetch (no authentication) |
| `connectors.list()` | Array of available connector names |
| `connectors.get(name)` | Connector info: `{ displayName, description, baseURL, serviceType }` |
| `console.log/error/warn` | Captured in logs (returned in test results) |
| `JSON, Math, Date, Buffer, Promise` | Standard globals |
| `Array, Object, String, Number, Boolean` | Built-in types |
| `RegExp, Map, Set, Error, URL, URLSearchParams` | Utility types |
| `TextEncoder, TextDecoder` | Text encoding |
| `setTimeout, setInterval` | Timers |

**Limitations:** No file system access, no `require`/`import`, code runs in async context (top-level `await` is available).

#### Tool Definition Schema

```typescript
interface CustomToolDefinition {
  version: number;                         // Format version (currently 1)
  name: string;                            // Unique name (/^[a-z][a-z0-9_]*$/)
  displayName?: string;                    // Human-readable name
  description: string;                     // What the tool does
  inputSchema: Record<string, unknown>;    // JSON Schema (must have type: 'object')
  outputSchema?: Record<string, unknown>;  // Optional output schema (documentation only)
  code: string;                            // JavaScript code for the VM sandbox
  createdAt: string;                       // ISO timestamp
  updatedAt: string;                       // ISO timestamp
  metadata?: {
    tags?: string[];                       // Categorization tags
    category?: string;                     // Category grouping
    author?: string;                       // Creator identifier
    generationPrompt?: string;             // The prompt used to create this tool
    testCases?: CustomToolTestCase[];      // Saved test cases
    requiresConnector?: boolean;           // Whether connectors are needed
    connectorNames?: string[];             // Which connectors the tool uses
  };
}
```

#### ToolManager Metadata

When registering hydrated custom tools, you can set provenance metadata:

```typescript
const tool = hydrateCustomTool(definition);

agent.tools.register(tool, {
  source: 'custom',            // Track origin (built-in, connector, custom, mcp)
  tags: ['api', 'weather'],    // Categorization
  category: 'external-apis',   // Grouping
});
```

These fields are preserved through `getState()`/`loadState()` for session persistence.

#### Storage Path

```
~/.oneringai/users/<userId>/custom-tools/
├── _index.json              # Index for fast listing and search
├── celsius_to_fahrenheit.json
├── fetch_weather.json
└── list_repos.json
```

---

### Developer Tools (Filesystem & Shell)

A comprehensive set of tools for file system operations and shell command execution, inspired by Claude Code. Perfect for building coding assistants, DevOps agents, or any agent that needs to interact with the local filesystem.

#### Quick Start

```typescript
import { developerTools } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: developerTools, // All 11 tools included (filesystem, bash, dev server, background process management)
});

// Agent can now read, write, edit files, search, and run commands
await agent.run('Read the package.json and tell me the version');
```

#### Individual Tools

You can also import and configure tools individually:

```typescript
import {
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createGlobTool,
  createGrepTool,
  createListDirectoryTool,
  createBashTool,
} from '@everworker/oneringai';

// Create tools with custom configuration
const readFile = createReadFileTool({
  workingDirectory: '/path/to/project',
  maxFileSize: 5 * 1024 * 1024, // 5MB
});

const bash = createBashTool({
  workingDirectory: '/path/to/project',
  defaultTimeout: 60000, // 1 minute
  allowBackground: true,
});
```

#### Filesystem Tools

##### read_file

Read file contents with line numbers. Automatically converts binary document formats (PDF, DOCX, XLSX, PPTX, ODT, ODP, ODS, RTF, PNG, JPG, GIF, WEBP) to markdown text via [Document Reader](#document-reader).

```typescript
// Text files — returns content with line numbers
read_file({
  file_path: '/path/to/file.ts',
  offset: 50,    // Start at line 50 (optional)
  limit: 100,    // Read 100 lines (optional)
});
// Returns: { success: true, content: "1\tconst x = 1;...", lines: 100 }

// Binary documents — auto-converted to markdown
read_file({ file_path: '/path/to/report.pdf' });
// Returns: { success: true, content: "# Document: report.pdf\n...", encoding: 'document' }
```

##### write_file

Create or overwrite files. Automatically creates parent directories.

```typescript
write_file({
  file_path: '/path/to/new/file.ts',
  content: 'export const hello = "world";',
});
// Returns: { success: true, created: true, bytesWritten: 29 }
```

##### edit_file

Surgical find-and-replace edits. Ensures uniqueness to prevent unintended changes.

```typescript
edit_file({
  file_path: '/path/to/file.ts',
  old_string: 'const x = 1;',
  new_string: 'const x = 42;',
  replace_all: false, // Fails if old_string is not unique (default)
});
// Returns: { success: true, replacements: 1 }
```

##### glob

Find files by pattern.

```typescript
glob({
  pattern: '**/*.ts',
  path: '/path/to/project', // Optional, defaults to cwd
});
// Returns: { success: true, files: ['src/index.ts', 'src/utils.ts', ...], count: 15 }
```

##### grep

Search file contents with regex.

```typescript
grep({
  pattern: 'function\\s+\\w+',
  path: '/path/to/project',
  type: 'ts',                      // Filter by file type
  output_mode: 'content',          // 'content', 'files_with_matches', 'count'
  case_insensitive: true,
  context_before: 2,               // Lines before match
  context_after: 2,                // Lines after match
});
// Returns: { success: true, matches: [...], filesMatched: 5, totalMatches: 23 }
```

##### list_directory

List directory contents with metadata.

```typescript
list_directory({
  path: '/path/to/project',
  recursive: true,
  filter: 'files',     // 'files' or 'directories'
  max_depth: 3,
});
// Returns: { success: true, entries: [...], count: 42 }
```

#### Shell Tool

##### bash

Execute shell commands with timeout and safety features.

```typescript
bash({
  command: 'npm install',
  timeout: 300000,        // 5 minutes
  description: 'Install dependencies',
  run_in_background: false,
});
// Returns: { success: true, stdout: '...', exitCode: 0, duration: 5234 }
```

**Safety Features:**
- Blocks dangerous commands (`rm -rf /`, fork bombs, etc.)
- Configurable timeout (default 2 min, max 10 min)
- Output truncation for large outputs
- Background execution support

**Blocked Commands:**
- `rm -rf /` and `rm -rf /*`
- Fork bombs (`:(){:|:&};:`)
- `/dev/sda` writes
- (git operations are not runtime-blocked — the tool description only instructs the agent to avoid risky git operations like force-push/reset --hard without permission)

#### Configuration Options

All filesystem tools share common configuration:

```typescript
interface FilesystemToolConfig {
  workingDirectory?: string;       // Base directory (default: cwd)
  allowedDirectories?: string[];   // Restrict to these directories
  blockedDirectories?: string[];   // Block access (default: node_modules, .git)
  maxFileSize?: number;            // Max read size (default: 10MB)
  maxResults?: number;             // Max results for glob/grep (default: 1000)
  followSymlinks?: boolean;        // Follow symlinks (default: false)
  excludeExtensions?: string[];    // Skip binary files
}
```

Shell tool configuration:

```typescript
interface ShellToolConfig {
  workingDirectory?: string;       // Working directory
  defaultTimeout?: number;         // Default timeout (default: 120000ms)
  maxTimeout?: number;             // Max timeout (default: 600000ms)
  maxOutputSize?: number;          // Max output size (default: 10MB)
  allowBackground?: boolean;       // Allow background execution (default: true)
  shell?: string;                  // Shell to use (default: /bin/bash)
  env?: Record<string, string>;    // Environment variables
}
```

#### Best Practices

1. **Use edit_file for code changes** - Never rewrite entire files; use surgical edits
2. **Prefer glob over bash find** - More efficient and safer
3. **Prefer grep over bash grep** - Better output formatting and safety
4. **Set working directory** - Restrict operations to project directory
5. **Configure blockedDirectories** - Prevent accidental access to sensitive directories

### Desktop Automation Tools

OS-level desktop automation for "computer use" agent loops. Enables agents to see and interact with the desktop: take screenshots, move the mouse, click, type, press keyboard shortcuts, and manage windows.

#### Quick Start

```typescript
import { desktopTools, Agent, Connector, Vendor } from '@everworker/oneringai';

// Setup
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: desktopTools,
});

// The agent loop: screenshot → vision model → tool calls → repeat
await agent.run('Take a screenshot, then open the Calculator app and compute 42 * 17');
```

#### Prerequisites

Desktop tools require `@nut-tree-fork/nut-js` as an optional peer dependency:

```bash
npm install @nut-tree-fork/nut-js
```

On macOS, you must grant accessibility permissions to your terminal app:
**System Settings → Privacy & Security → Accessibility → Enable your terminal/IDE**.

#### Available Tools

| Tool | Args | Description |
|------|------|-------------|
| `desktop_screenshot` | `region?` | Capture full screen or a specific region. Returns image to vision model via `__images` convention. |
| `desktop_mouse_move` | `x, y` | Move the cursor to a position (in screenshot pixel coords). |
| `desktop_mouse_click` | `x?, y?, button?, clickCount?` | Click at position or current location. Supports left/right/middle, single/double/triple. |
| `desktop_mouse_drag` | `startX, startY, endX, endY, button?` | Drag from start to end position. |
| `desktop_mouse_scroll` | `deltaX?, deltaY?, x?, y?` | Scroll wheel. Positive deltaY = down, negative = up. |
| `desktop_get_cursor` | (none) | Get current cursor position in screenshot coords. |
| `desktop_keyboard_type` | `text, delay?` | Type text as keyboard input. |
| `desktop_keyboard_key` | `keys` | Press key combo (e.g., `"ctrl+c"`, `"cmd+shift+s"`, `"enter"`). |
| `desktop_get_screen_size` | (none) | Get physical/logical dimensions and scale factor. |
| `desktop_window_list` | (none) | List visible windows with IDs, titles, and bounds. |
| `desktop_window_focus` | `windowId` | Bring a window to the foreground. |

#### Coordinate System

All coordinates use **physical pixel space** (screenshot space). This means the coordinates you see in a screenshot image are the exact coordinates you pass to mouse tools. The driver handles Retina/HiDPI scaling internally.

```
Screenshot pixels (2560×1600 on Retina) ← Tools accept these coords
         ↕ driver divides by scaleFactor
OS logical coords (1280×800)             ← nut-tree operates here
```

#### Configuration

```typescript
import { createDesktopScreenshotTool, createDesktopMouseClickTool } from '@everworker/oneringai';

// Custom config for individual tools
const screenshot = createDesktopScreenshotTool({
  humanDelay: [0, 0],        // No delay (instant actions)
  humanizeMovement: false,    // Straight-line mouse movement
});

// Or provide a custom driver implementation
import type { IDesktopDriver } from '@everworker/oneringai';

const myDriver: IDesktopDriver = { /* custom implementation */ };
const click = createDesktopMouseClickTool({ driver: myDriver });
```

#### The `__images` Convention

The `desktop_screenshot` tool returns an `__images` array in its result. This is automatically handled by all provider converters:

- **Anthropic**: Image blocks inside `tool_result` content
- **OpenAI**: Follow-up user message with `input_image`
- **Google**: `inlineData` parts alongside `functionResponse`

The base64 image data is stripped from the text content to save tokens — only the image blocks are sent to the vision model.

#### Key Combo Syntax

The `desktop_keyboard_key` tool accepts key combo strings with `+` as separator:

- **Modifiers**: `ctrl`, `cmd`/`command`/`meta`, `alt`/`option`, `shift`
- **Special keys**: `enter`, `tab`, `escape`, `backspace`, `delete`, `space`
- **Arrow keys**: `up`, `down`, `left`, `right`
- **Function keys**: `f1` through `f12`
- **Navigation**: `home`, `end`, `pageup`, `pagedown`
- **Letters/digits**: `a`-`z`, `0`-`9`

Examples: `"ctrl+c"`, `"cmd+shift+s"`, `"alt+tab"`, `"enter"`, `"f5"`

### Document Reader

Universal file-to-LLM-content converter. Reads arbitrary document formats (Office, PDF, spreadsheets, HTML, text, images) from any source and produces clean markdown text with optional image extraction.

#### How It Works

The Document Reader is integrated at three levels:

1. **`read_file` tool** — Agents calling `read_file` on binary documents (PDF, DOCX, XLSX, PPTX, etc.) automatically get markdown text. No code changes needed.
2. **`web_fetch` tool** — Documents downloaded from URLs (detected via Content-Type or extension) are auto-converted to markdown.
3. **Programmatic API** — `DocumentReader.read()` and `readDocumentAsContent()` for direct use in application code.

#### Supported Formats

| Format | Extensions | Handler | Library |
|--------|-----------|---------|---------|
| **Office** | .docx, .pptx, .odt, .odp, .ods, .rtf | OfficeHandler | officeparser (lazy-loaded) |
| **Spreadsheet** | .xlsx, .csv | ExcelHandler | exceljs (lazy-loaded) |
| **PDF** | .pdf | PDFHandler | unpdf (lazy-loaded) |
| **HTML** | .html, .htm | HTMLHandler | Readability + Turndown (built-in) |
| **Text** | .txt, .md, .json, .xml, .yaml, .yml | TextHandler | none |
| **Image** | .png, .jpg, .jpeg, .gif, .webp, .svg | ImageHandler | none |

All heavy dependencies are **lazy-loaded** via dynamic `import()` — they are only loaded when a document of that type is first read, keeping startup fast.

#### Quick Start — Agent with read_file

The simplest way to use Document Reader is through agents with developer tools:

```typescript
import { Agent, developerTools } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: developerTools,
});

// read_file auto-detects binary formats and converts to markdown
await agent.run('Read /path/to/quarterly-report.pdf and summarize it');
await agent.run('Read /path/to/sales-data.xlsx and identify the top performers');
await agent.run('Read /path/to/onboarding.pptx and list the key steps');
await agent.run('Read /path/to/contract.docx and highlight important clauses');
```

The `read_file` tool automatically detects binary document formats (PDF, DOCX, XLSX, PPTX, ODT, ODP, ODS, RTF, PNG, JPG, GIF, WEBP) and converts them to markdown. Text files (.txt, .md, .json, .xml, .yaml, .csv, .html) continue to be read as UTF-8 text as before.

#### Quick Start — web_fetch with Documents

The `web_fetch` tool auto-detects document Content-Types and URL extensions:

```typescript
import { Agent, tools } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tools.webFetch],
});

// web_fetch detects PDF content-type and converts to markdown
await agent.run('Fetch https://example.com/annual-report.pdf and summarize it');
```

When `web_fetch` detects a document MIME type (`application/pdf`, Office MIME types, etc.) or a document URL extension (`.pdf`, `.docx`, `.xlsx`), it downloads the file and converts it to markdown using DocumentReader. The result has `contentType: 'document'` in the response.

#### Programmatic Usage — DocumentReader

For application code (outside of tool context):

```typescript
import { DocumentReader, mergeTextPieces } from '@everworker/oneringai';

// Create reader with defaults
const reader = DocumentReader.create({
  defaults: {
    maxTokens: 50_000,
    extractImages: true,
    imageFilter: { minWidth: 100, minHeight: 100 },
  },
});

// Read from different sources
const result = await reader.read('/path/to/report.pdf');
const result = await reader.read('https://example.com/doc.xlsx');
const result = await reader.read({ type: 'buffer', buffer: uploadedBuffer, filename: 'doc.docx' });
const result = await reader.read({ type: 'blob', blob: fileBlob, filename: 'slides.pptx' });

// Get merged text
const markdown = mergeTextPieces(result.pieces);
console.log(markdown);

// Access individual pieces
for (const piece of result.pieces) {
  if (piece.type === 'text') {
    console.log(`[${piece.metadata.section}] ${piece.content.substring(0, 100)}...`);
  } else {
    console.log(`[Image] ${piece.mimeType} (${piece.metadata.sizeBytes} bytes)`);
  }
}

// Metadata
console.log(result.metadata.format);           // 'pdf'
console.log(result.metadata.family);           // 'pdf'
console.log(result.metadata.estimatedTokens);  // 12500
console.log(result.metadata.totalPieces);      // 15
console.log(result.metadata.totalImagePieces); // 3
console.log(result.metadata.processingTimeMs); // 234
```

#### Content Bridge — readDocumentAsContent()

For multimodal LLM input (text + images), use the content bridge:

```typescript
import { readDocumentAsContent, documentToContent } from '@everworker/oneringai';

// One-call convenience: read + filter + convert to Content[]
const content = await readDocumentAsContent('/path/to/slides.pptx', {
  extractImages: true,
  imageDetail: 'auto',
  imageFilter: { minWidth: 100, minHeight: 100 },
  maxImages: 20,
  mergeAdjacentText: true,
});

// Use with agent
const response = await agent.run([
  { type: 'input_text', text: 'Analyze this presentation:' },
  ...content,
]);

// Or use documentToContent() for two-step conversion
const reader = DocumentReader.create();
const result = await reader.read('/path/to/doc.pdf');
const content = documentToContent(result, {
  imageDetail: 'low',
  maxImages: 10,
});
```

**Output Content types:**
- `DocumentTextPiece` → `InputTextContent { type: 'input_text', text }`
- `DocumentImagePiece` → `InputImageContent { type: 'input_image_url', image_url: { url: 'data:...' } }`

#### Read Options

All options are configurable at two levels — reader creation time (defaults) and per-call:

```typescript
const reader = DocumentReader.create({
  defaults: {
    maxTokens: 100_000,         // Max estimated tokens in output
    maxOutputBytes: 5_242_880,  // Max output size (5MB)
    extractImages: true,        // Extract images from documents
    imageDetail: 'auto',        // Image detail for LLM ('auto', 'low', 'high')
    imageFilter: {
      minWidth: 50,             // Skip images narrower than this
      minHeight: 50,            // Skip images shorter than this
      minSizeBytes: 1024,       // Skip images smaller than this
      maxImages: 50,            // Max images to keep
      excludePatterns: [/logo/i, /icon/i],  // Exclude by label pattern
    },
    formatOptions: {
      excel: {
        maxRows: 1000,          // Max rows per sheet
        maxColumns: 50,         // Max columns per sheet
        tableFormat: 'markdown', // 'markdown', 'csv', or 'json'
        includeFormulas: false,
      },
      pdf: {
        includeMetadata: true,  // Include title, author, page count
      },
      html: {
        maxLength: 50_000,      // Max HTML length to process
      },
      office: {
        includeSpeakerNotes: true, // Include PPTX speaker notes
      },
    },
  },
  maxDownloadSizeBytes: 50_000_000, // Max file size for URL sources (50MB)
  downloadTimeoutMs: 60_000,        // Download timeout for URL sources
});

// Per-call override
const result = await reader.read('/path/to/large.pdf', {
  maxTokens: 200_000,       // Override just for this call
  extractImages: false,      // Text-only for this call
  pages: [1, 2, 3],         // Only read specific pages
});
```

#### Format-Specific Behavior

**PPTX/ODP (Presentations):**
- Split into per-slide pieces with `### Slide N` headers
- Speaker notes included by default (configurable)
- Images extracted from slides as separate pieces

**XLSX (Spreadsheets):**
- Each sheet becomes a separate piece with `## Sheet: Name` header
- Three table output formats: `markdown` (default), `csv`, `json`
- Typed cell values (dates, numbers, formulas)
- Row/column limits configurable

**PDF:**
- Per-page text pieces with `Page N` sections
- Document metadata (title, author, pages) included as first piece
- Image extraction supported

**CSV:**
- Auto-detected as spreadsheet family
- Converted to markdown table by default

**Images:**
- Pass-through as base64 image pieces
- SVG files produce both an image piece and a text piece (SVG source)

**JSON/XML/YAML:**
- Wrapped in fenced code blocks with language tags

#### Transformer Pipeline

Documents pass through a configurable transformer pipeline after extraction:

| Transformer | Priority | Applies To | Description |
|-------------|----------|-----------|-------------|
| `documentHeaderTransformer` | 10 | All | Prepends `# Document: filename` with format and size |
| `tableFormattingTransformer` | 50 | xlsx, csv | Normalizes markdown table column alignment |
| `truncationTransformer` | 1000 | All | Enforces maxTokens limit, truncates at paragraph boundaries |

**Custom transformers:**

```typescript
import type { IDocumentTransformer } from '@everworker/oneringai';

const myTransformer: IDocumentTransformer = {
  name: 'addWatermark',
  appliesTo: [],  // empty = all formats
  priority: 20,
  async transform(pieces, context) {
    // Add a watermark to each text piece
    return pieces.map(p => p.type === 'text'
      ? { ...p, content: p.content + '\n\n_Processed by MyApp_' }
      : p
    );
  },
};

const result = await reader.read('/path/to/doc.pdf', {
  transformers: [myTransformer],
});
```

#### Custom Format Handlers

Replace or extend built-in handlers:

```typescript
import type { IFormatHandler } from '@everworker/oneringai';

const customPDFHandler: IFormatHandler = {
  name: 'MyPDFHandler',
  supportedFormats: ['pdf'],
  async handle(buffer, filename, format, options) {
    // Custom PDF parsing logic
    return [{ type: 'text', content: '...', metadata: {} }];
  },
};

const reader = DocumentReader.create();
reader.registerHandler('pdf', customPDFHandler);
```

#### Image Filtering

Image filtering removes small/junk images (logos, icons, backgrounds) at two stages:

1. **Extraction time** — Applied in `DocumentReader.read()` after the format handler runs
2. **Content conversion time** — Applied in `documentToContent()` / `readDocumentAsContent()`

```typescript
// Extraction-time filtering (in DocumentReader)
const result = await reader.read('/path/to/slides.pptx', {
  imageFilter: {
    minWidth: 100,       // Skip images narrower than 100px
    minHeight: 100,      // Skip images shorter than 100px
    minSizeBytes: 2048,  // Skip images smaller than 2KB
    maxImages: 30,       // Keep at most 30 images
    excludePatterns: [/logo/i, /background/i],
  },
});

// Content-conversion-time filtering (additional pass)
const content = documentToContent(result, {
  imageFilter: { minWidth: 200 },  // Stricter for LLM input
  maxImages: 10,                    // Fewer images for LLM
  imageDetail: 'low',               // Low detail saves tokens
});
```

#### Error Handling

```typescript
import { AIError } from '@everworker/oneringai';

try {
  const result = await reader.read('/path/to/file.xyz');
} catch (error) {
  if (error instanceof AIError && error.code === 'UNSUPPORTED_FORMAT') {
    console.log(`Format not supported: ${error.message}`);
  } else if (error instanceof AIError && error.code === 'DOCUMENT_READ_ERROR') {
    console.log(`Read failed: ${error.message}`);
  }
}
```

#### Constants Reference

All defaults are defined in `DOCUMENT_DEFAULTS` and can be overridden:

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_OUTPUT_TOKENS` | 100,000 | Max estimated tokens in output |
| `MAX_OUTPUT_BYTES` | 5MB | Max output size in bytes |
| `MAX_DOWNLOAD_SIZE_BYTES` | 50MB | Max download size for URL sources |
| `DOWNLOAD_TIMEOUT_MS` | 60,000 | Download timeout for URL sources |
| `MAX_EXTRACTED_IMAGES` | 50 | Max images extracted from a single document |
| `MAX_EXCEL_ROWS` | 1,000 | Max rows per Excel sheet |
| `MAX_EXCEL_COLUMNS` | 50 | Max columns per Excel sheet |
| `MAX_HTML_LENGTH` | 10,000,000 | Max HTML content length |
| `CHARS_PER_TOKEN` | 4 | Chars per token estimate |
| `IMAGE_FILTER.MIN_WIDTH` | 50 | Default minimum image width |
| `IMAGE_FILTER.MIN_HEIGHT` | 50 | Default minimum image height |
| `IMAGE_FILTER.MIN_SIZE_BYTES` | 1,024 | Default minimum image size |

### Web Tools

Tools for fetching web content, searching the web, and scraping pages. `tools.webFetch` is a connector-free tool; `web_search` and `web_scrape` are connector-dependent (via the `ConnectorTools` pattern).

#### tools.webFetch

Fetch and process web content. Converts HTML to markdown for easy consumption by LLMs. Also auto-detects document formats (PDF, DOCX, XLSX, etc.) by Content-Type or URL extension and converts them to markdown via [Document Reader](#document-reader).

```typescript
import { Agent, tools } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tools.webFetch],
});

await agent.run('Fetch https://example.com and summarize it');
```

**Parameters:**
- `url` (required) — URL to fetch
- `userAgent` — Custom user agent string (default: a generic bot user agent)
- `timeout` — Timeout in milliseconds (default: 10000)

#### web_search (ConnectorTools)

Web search via ConnectorTools pattern. Create a connector with a search service type, then use `ConnectorTools.for()` to get the tools.

**Supported service types:** `serper`, `brave-search`, `tavily`, `rapidapi-search`

```typescript
import { Connector, ConnectorTools, Agent, tools } from '@everworker/oneringai';

// Create a search connector
Connector.create({
  name: 'serper',
  serviceType: 'serper',
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

// Get search tools from the connector
const searchTools = ConnectorTools.for('serper');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tools.webFetch, ...searchTools],
});

await agent.run('Search for the latest Node.js release');
```

**Parameters:**
- `query` (required) — Search query
- `numResults` — Number of results (default: 10)
- `country` — Country/region code (e.g., "us", "gb")
- `language` — Language code (e.g., "en", "fr")

#### web_scrape (ConnectorTools)

Web scraping via ConnectorTools pattern. Tries native fetch first, falls back to the bound scrape provider.

**Supported service types:** `zenrows`, `jina-reader`, `firecrawl`, `scrapingbee`

```typescript
import { Connector, ConnectorTools } from '@everworker/oneringai';

Connector.create({
  name: 'zenrows',
  serviceType: 'zenrows',
  auth: { type: 'api_key', apiKey: process.env.ZENROWS_API_KEY! },
  baseURL: 'https://api.zenrows.com/v1',
});

const scrapeTools = ConnectorTools.for('zenrows');
```

**Parameters:**
- `url` (required) — URL to scrape
- `includeMarkdown` — Convert to markdown
- `includeLinks` — Extract links
- `includeHtml` — Include raw HTML
- `waitForSelector` — CSS selector to wait for
- `timeout` — Timeout in milliseconds

### JSON Tool

#### tools.jsonManipulator

Manipulate JSON objects — add, delete, or replace fields.

```typescript
import { Agent, tools } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tools.jsonManipulator],
});

await agent.run('Add a "version" field set to "2.0" to this JSON: {"name": "app"}');
```

**Parameters:**
- `object` (required) — JSON object to manipulate (not a string)
- `operation` (required) — `"add"`, `"delete"`, or `"replace"`
- `path` (required) — JSON path (dot notation, e.g., `"config.debug"`)
- `value` — Value for add/replace operations

### GitHub Connector Tools

When a GitHub connector is configured, `ConnectorTools.for('github')` automatically includes 8 dedicated tools alongside the generic API tool (including `list_branches`, not otherwise documented here). These mirror the local filesystem tools for remote GitHub repositories.

#### Quick Start

```typescript
import { Connector, ConnectorTools, Services, Agent } from '@everworker/oneringai';

// Create a GitHub connector
Connector.create({
  name: 'github',
  serviceType: Services.Github,
  auth: { type: 'api_key', apiKey: process.env.GITHUB_TOKEN! },
  baseURL: 'https://api.github.com',
  options: {
    defaultRepository: 'myorg/myrepo', // Optional: default repo for all tools
  },
});

// Get all GitHub tools (generic API + 8 dedicated tools)
const tools = ConnectorTools.for('github');

// Use with an agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: tools,
});

// Agent can now search files, read code, analyze PRs, and create PRs
await agent.run('Find all TypeScript files in src/ and show me the main entry point');
await agent.run('Show me PR #42 and summarize the changes');
```

#### Repository Resolution

All GitHub tools accept an optional `repository` parameter. Resolution order:

1. **Explicit parameter**: `{ "repository": "owner/repo" }` or `{ "repository": "https://github.com/owner/repo" }`
2. **Connector default**: `connector.options.defaultRepository`
3. **Error**: If neither is available

This means you can configure a default repo once on the connector and all tools use it automatically.

#### search_files

Search for files by glob pattern in a repository. Mirrors the local `glob` tool.

```jsonc
// Find TypeScript files
{ "pattern": "**/*.ts" }

// Search in specific path
{ "pattern": "src/components/**/*.tsx", "repository": "facebook/react" }

// Search specific branch
{ "pattern": "**/*.test.ts", "ref": "develop" }
```

**Parameters:**
- `repository` — Repository in `"owner/repo"` format or GitHub URL (optional if connector has default)
- `pattern` (required) — Glob pattern (`**/*.ts`, `src/**/*.tsx`, etc.)
- `ref` — Branch, tag, or commit SHA (defaults to default branch)

**Returns:** `{ files: [{ path, size, type }], count, truncated }`

#### search_code

Search code content across a repository. Mirrors the local `grep` tool.

```jsonc
// Find function usage
{ "query": "handleAuth", "language": "typescript" }

// Search in specific path
{ "query": "TODO", "path": "src/utils", "extension": "ts" }
```

**Parameters:**
- `repository` — Repository (optional)
- `query` (required) — Search term
- `language` — Filter by language (`"typescript"`, `"python"`, etc.)
- `path` — Filter by path prefix (`"src/"`)
- `extension` — Filter by extension (`"ts"`, `"py"`)
- `limit` — Max results (default: 30, max: 100)

**Returns:** `{ matches: [{ file, fragment }], count, truncated }`

> **Note:** GitHub's code search API is rate-limited to 30 requests per minute.

#### read_file (GitHub)

Read file content from a repository with line range support. Mirrors the local `read_file` tool.

```jsonc
// Read entire file
{ "path": "src/index.ts" }

// Read specific lines
{ "path": "src/app.ts", "offset": 100, "limit": 50 }

// Read from specific branch
{ "path": "README.md", "ref": "develop" }
```

**Parameters:**
- `repository` — Repository (optional)
- `path` (required) — File path within the repo
- `ref` — Branch, tag, or SHA
- `offset` — Start line (1-indexed)
- `limit` — Number of lines (default: 2000)

**Returns:** `{ content: "1\tline one\n2\tline two...", lines, size, truncated, sha }`

Output is formatted with line numbers matching the local `read_file` format. Files larger than 1MB are automatically fetched via the Git Blob API.

#### get_pr

Get full details of a pull request.

```jsonc
{ "pull_number": 42 }
{ "pull_number": 42, "repository": "owner/repo" }
```

**Parameters:**
- `repository` — Repository (optional)
- `pull_number` (required) — PR number

**Returns:** `{ data: { number, title, body, state, draft, author, labels, reviewers, mergeable, head, base, url, created_at, updated_at, additions, deletions, changed_files } }`

#### pr_files

Get files changed in a PR with diffs.

```jsonc
{ "pull_number": 42 }
```

**Parameters:**
- `repository` — Repository (optional)
- `pull_number` (required) — PR number

**Returns:** `{ files: [{ filename, status, additions, deletions, changes, patch }], count }`

The `status` field is one of: `added`, `modified`, `removed`, `renamed`. The `patch` field contains the unified diff.

#### pr_comments

Get all comments and reviews on a PR, merged from three GitHub API endpoints into a unified format.

```jsonc
{ "pull_number": 42 }
```

**Parameters:**
- `repository` — Repository (optional)
- `pull_number` (required) — PR number

**Returns:** `{ comments: [{ id, type, author, body, created_at, path?, line?, state? }], count }`

Comment types:
- `review_comment` — Line-level comments on code (includes `path` and `line`)
- `review` — Full reviews (approve/request changes/comment, includes `state`)
- `comment` — General PR comments

All entries are sorted by creation date (oldest first).

#### create_pr

Create a pull request.

```jsonc
// Basic PR
{ "title": "Add feature", "head": "feature-branch", "base": "main" }

// Draft PR with description
{
  "title": "WIP: Refactor auth",
  "body": "## Changes\n- Refactored auth flow\n- Added tests",
  "head": "refactor/auth",
  "base": "main",
  "draft": true
}
```

**Parameters:**
- `repository` — Repository (optional)
- `title` (required) — PR title
- `body` — PR description (Markdown supported)
- `head` (required) — Source branch name
- `base` (required) — Target branch name
- `draft` — Create as draft (default: false)

**Returns:** `{ data: { number, url, state, title } }`

> **Permission:** This tool has `riskLevel: 'medium'` since it creates external state.

#### Using Individual GitHub Tool Factories

You can also create GitHub tools individually for custom setups:

```typescript
import {
  createSearchFilesTool,
  createSearchCodeTool,
  createGitHubReadFileTool,
  createListBranchesTool,
  createGetPRTool,
  createPRFilesTool,
  createPRCommentsTool,
  createCreatePRTool,
  parseRepository,
} from '@everworker/oneringai';

// Create individual tools from a connector
const connector = Connector.get('github');
const searchFiles = createSearchFilesTool(connector);
const readFile = createGitHubReadFileTool(connector);

// Use parseRepository for URL resolution
const { owner, repo } = parseRepository('https://github.com/facebook/react');
```

### Slack Connector Tools

When a Slack connector is configured, `ConnectorTools.for('slack')` adds ten
purpose-built tools alongside the generic authenticated API tool.

```typescript
import {
  Agent,
  ConnectorTools,
  createConnectorFromTemplate,
} from '@everworker/oneringai';

createConnectorFromTemplate(
  'work-slack',
  'slack',
  'bot-token',
  { apiKey: process.env.SLACK_BOT_TOKEN! },
);

const slackTools = ConnectorTools.for('work-slack');

const agent = Agent.create({
  connector: 'openai-main',
  model: 'gpt-5.6-terra',
  identities: [{ connector: 'work-slack' }],
  tools: slackTools,
});
```

The names visible to the model are prefixed with the connector name—for
example `work_slack_post_message`—so multiple Slack workspaces can be attached
without collisions.

| Base tool | Purpose |
|-----------|---------|
| `list_channels` | List channels visible to the connector identity |
| `get_channel_info` | Fetch channel metadata |
| `set_channel_topic` | Change a channel topic |
| `get_messages` | Read recent channel messages |
| `get_thread` | Read a message thread and replies |
| `post_message` | Post a message to a channel or thread |
| `search_messages` | Search Slack messages |
| `get_mentions` | Retrieve messages mentioning the authenticated user/bot |
| `add_reaction` | Add an emoji reaction to a message |
| `get_users` | List workspace users |

All operations still pass through `ToolManager` permissions and the connector's
retry, circuit-breaker, metrics, multi-user OAuth, and account-binding logic.
Use the generic `{connectorName}_api` tool for Slack methods not covered by this
pack. See the [Connector & Tool Catalog](./docs/CONNECTOR_TOOL_CATALOG.md) for
the complete specialized-service matrix.

### Microsoft Graph Connector Tools

When a Microsoft connector is configured, `ConnectorTools.for('microsoft')` automatically includes 11 dedicated tools alongside the generic API tool. These enable email, calendar, meetings, Teams transcript, and OneDrive/SharePoint file workflows.

#### Quick Start

```typescript
import { Connector, ConnectorTools, Services, Agent } from '@everworker/oneringai';

// Create a Microsoft connector with OAuth
Connector.create({
  name: 'microsoft',
  serviceType: Services.Microsoft,
  auth: { type: 'oauth', /* ... OAuth config ... */ },
  baseURL: 'https://graph.microsoft.com/v1.0',
});

// Get all Microsoft tools (generic API + 11 dedicated tools)
const tools = ConnectorTools.for('microsoft');

// Use with an agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: tools,
});

await agent.run('Draft an email to alice@example.com about the project update');
await agent.run('Schedule a 30-minute Teams meeting with bob@example.com next Tuesday at 2pm');
await agent.run('Find my recent files in OneDrive about the project plan');
```

#### Delegated vs Application Mode

Microsoft Graph supports two permission modes:

| Mode | Path Prefix | Use Case |
|------|-------------|----------|
| **Delegated** | `/me` | User signs in via OAuth. Tools access the signed-in user's mailbox/calendar. |
| **Application** | `/users/{targetUser}` | App authenticates as itself (client_credentials). Requires `targetUser` parameter in each tool call. |

All 11 tools accept an optional `targetUser` parameter (email or user ID). When using delegated auth, this is ignored and `/me` is used automatically.

#### create_draft_email

Create a draft email or draft reply in the user's Outlook mailbox.

```jsonc
// New draft
{ "to": ["alice@example.com"], "subject": "Project Update", "body": "<p>Here's the latest...</p>" }

// Reply draft
{ "to": ["alice@example.com"], "subject": "Re: Project", "body": "<p>Thanks!</p>", "replyToMessageId": "AAMkAG..." }
```

**Parameters:**
- `to` (required, string[]) — Recipient email addresses
- `subject` (required) — Email subject
- `body` (required) — Email body as HTML
- `cc` (optional, string[]) — CC email addresses
- `replyToMessageId` (optional) — Graph message ID to create a reply draft
- `targetUser` (optional) — User ID/email for app-only auth

**Returns:** `{ success, draftId, webLink }`

#### send_email

Send an email immediately or reply to an existing message.

```jsonc
// Send new email
{ "to": ["bob@example.com"], "subject": "Meeting Notes", "body": "<p>Attached are the notes.</p>" }

// Reply to existing message
{ "to": ["bob@example.com"], "subject": "Re: Meeting Notes", "body": "<p>Thanks!</p>", "replyToMessageId": "AAMkAG..." }
```

**Parameters:**
- `to` (required, string[]) — Recipient email addresses
- `subject` (required) — Email subject
- `body` (required) — Email body as HTML
- `cc` (optional, string[]) — CC email addresses
- `replyToMessageId` (optional) — Graph message ID to reply to
- `replyAll` (optional, boolean) — When true with `replyToMessageId`, replies to all original recipients (To + CC) instead of just the sender. Default: false.
- `targetUser` (optional) — User ID/email for app-only auth

**Returns:** `{ success }`

#### create_meeting

Create a calendar event on the user's Outlook calendar, optionally with a Teams online meeting link.

```jsonc
// Simple meeting
{
  "subject": "Sprint Review",
  "startDateTime": "2026-03-01T14:00:00",
  "endDateTime": "2026-03-01T14:30:00",
  "attendees": ["alice@example.com", "bob@example.com"],
  "isOnlineMeeting": true,
  "timeZone": "America/New_York"
}
```

**Parameters:**
- `subject` (required) — Meeting title
- `startDateTime` (required) — ISO 8601 without timezone (e.g., `"2026-03-01T14:00:00"`)
- `endDateTime` (required) — ISO 8601 without timezone
- `attendees` (required, string[]) — Attendee email addresses
- `body` (optional) — Meeting description as HTML
- `isOnlineMeeting` (optional, boolean) — Set `true` to generate a Teams meeting link
- `location` (optional) — Physical location
- `timeZone` (optional) — IANA timezone (default: `"UTC"`)
- `targetUser` (optional) — User ID/email for app-only auth

**Returns:** `{ success, eventId, webLink, onlineMeetingUrl }`

#### edit_meeting

Update an existing Outlook calendar event. Only the fields you provide are changed.

```json
{ "eventId": "AAMkAG...", "subject": "Updated Sprint Review", "attendees": ["alice@example.com", "bob@example.com", "charlie@example.com"] }
```

**Parameters:**
- `eventId` (required) — Graph event ID from `create_meeting` result
- `subject` (optional) — New meeting title
- `startDateTime` (optional) — New start time
- `endDateTime` (optional) — New end time
- `attendees` (optional, string[]) — **Full replacement** attendee list (not additive)
- `body` (optional) — New description as HTML
- `isOnlineMeeting` (optional, boolean) — `true` = add Teams link, `false` = remove it
- `location` (optional) — New location
- `timeZone` (optional) — IANA timezone (default: `"UTC"`)
- `targetUser` (optional) — User ID/email for app-only auth

**Returns:** `{ success, eventId, webLink }`

> **Important:** The `attendees` parameter **replaces** the entire attendee list — it is not additive.

#### find_meeting_slots

Find available meeting time slots when all attendees are free.

```json
{
  "attendees": ["alice@example.com", "bob@example.com"],
  "startDateTime": "2026-03-01T08:00:00",
  "endDateTime": "2026-03-05T18:00:00",
  "duration": 30,
  "timeZone": "America/New_York",
  "maxResults": 5
}
```

**Parameters:**
- `attendees` (required, string[]) — Attendee email addresses
- `startDateTime` (required) — Search window start (ISO 8601 without timezone)
- `endDateTime` (required) — Search window end
- `duration` (required, number) — Meeting duration in minutes
- `timeZone` (optional) — IANA timezone (default: `"UTC"`)
- `maxResults` (optional, number) — Maximum suggestions (default: 5)
- `targetUser` (optional) — User ID/email for app-only auth

**Returns:** `{ success, slots: [{ start, end, confidence, attendeeAvailability }], emptySuggestionsReason }`

#### get_meeting_transcript

Retrieve the transcript from a Teams online meeting as plain text with speaker labels.

```jsonc
// By meeting ID
{ "meetingId": "MSoxMjM0NTY3..." }

// By Teams join URL
{ "meetingId": "https://teams.microsoft.com/l/meetup-join/..." }
```

**Parameters:**
- `meetingId` (required) — Teams online meeting ID or Teams meeting join URL
- `targetUser` (optional) — User ID/email for app-only auth

**Returns:** `{ success, transcript, meetingSubject }`

> **Note:** Requires `OnlineMeetingTranscript.Read.All` permission. The `meetingId` is the Teams online meeting ID (not the calendar event ID). It can be obtained from meeting details or extracted from the Teams join URL.

#### Required Microsoft Graph Permissions

| Tool | Delegated Scopes | Application Scopes |
|------|-------------------|-------------------|
| `create_draft_email` | `Mail.ReadWrite` | `Mail.ReadWrite` |
| `send_email` | `Mail.Send` | `Mail.Send` |
| `create_meeting` | `Calendars.ReadWrite` | `Calendars.ReadWrite` |
| `edit_meeting` | `Calendars.ReadWrite` | `Calendars.ReadWrite` |
| `find_meeting_slots` | `Calendars.Read` | `Calendars.Read` |
| `get_meeting_transcript` | `OnlineMeetingTranscript.Read.All` | `OnlineMeetingTranscript.Read.All` |

### Telegram Connector Tools

6 tools for Telegram Bot API, auto-registered via `ConnectorTools.for('telegram')` when you create a Telegram connector:

```typescript
import { createConnectorFromTemplate, Agent, Vendor, Connector } from '@everworker/oneringai';

// Create Telegram connector
createConnectorFromTemplate('my-bot', 'telegram', 'bot-token', {
  apiKey: process.env.TELEGRAM_BOT_TOKEN!,
});

// Agent with Telegram tools
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  identities: [{ connector: 'my-bot' }],  // Enables Telegram tools
});
```

| Tool | Description |
|------|-------------|
| `telegram_send_message(chat_id, text, parse_mode?)` | Send a text message with optional HTML/Markdown formatting |
| `telegram_send_photo(chat_id, photo, caption?)` | Send a photo by URL or file_id with optional caption |
| `telegram_get_updates(offset?, limit?, timeout?)` | Poll for incoming messages/events (supports long-polling) |
| `telegram_set_webhook(url, drop_pending_updates?)` | Set or remove webhook for push-based updates (pass `url: ""` to remove) |
| `telegram_get_me()` | Get bot info — useful as a connection test |
| `telegram_get_chat(chat_id)` | Get chat/group/channel details |

**Key patterns:**
- Token-in-URL: Telegram puts the bot token in the URL path (`/bot<TOKEN>/<method>`)
- All responses wrapped in `{ ok: boolean, result: T }`
- `telegramFetch()` helper handles auth, JSON encoding, timeout (including long-poll hold time), and error parsing

### Twilio Connector Tools

4 tools for SMS and WhatsApp messaging via Twilio, auto-registered via `ConnectorTools.for('twilio')`:

```typescript
import { createConnectorFromTemplate } from '@everworker/oneringai';

createConnectorFromTemplate('my-twilio', 'twilio', 'api-key', {
  apiKey: process.env.TWILIO_AUTH_TOKEN!,
  accountId: process.env.TWILIO_ACCOUNT_SID!,
}, {
  vendorOptions: {
    defaultFromNumber: '+15551234567',
    defaultWhatsAppNumber: '+15551234567',
  },
});
```

| Tool | Description |
|------|-------------|
| `send_sms(to, body, from?)` | Send an SMS. Uses `defaultFromNumber` from vendor options if `from` is omitted. |
| `send_whatsapp(to, body, from?, contentSid?)` | Send a WhatsApp message (freeform or pre-approved template via ContentSid). Uses `defaultWhatsAppNumber` if `from` is omitted. |
| `list_messages(to?, from?, dateSentAfter?, dateSentBefore?, channel?, limit?)` | List/filter messages by phone number, date range, and channel (SMS/WhatsApp/all) |
| `get_message(sid)` | Get full details of a single message by SID (status, price, errors) |

**Key patterns:**
- Basic Auth: Twilio uses HTTP Basic Auth (`accountSid:authToken` base64-encoded) — handled automatically by `buildAuthConfig()`
- Form-encoded POST: Twilio API uses `application/x-www-form-urlencoded` for mutations
- Phone helpers: `normalizePhoneNumber()` ensures E.164 format, `toWhatsAppNumber()` adds `whatsapp:` prefix
- Account SID resolution: `getAccountSid()` resolves from `extra.accountId` on the connector

### Google Workspace Connector Tools

11 tools for Google APIs (Gmail, Calendar, Meet, Drive), auto-registered via `ConnectorTools.for('google-api')` when a connector with `serviceType: 'google-api'` exists:

```typescript
import { Connector, ConnectorTools, Agent, Vendor } from '@everworker/oneringai';

// Create Google OAuth connector
Connector.create({
  name: 'google',
  vendor: Vendor.Google,
  baseURL: 'https://www.googleapis.com',
  auth: {
    type: 'oauth', flow: 'authorization_code',
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'http://localhost:3000/callback',
    scope: 'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly',
  },
  serviceType: 'google-api',
});

// Get all Google tools (generic API + 11 dedicated tools)
const tools = ConnectorTools.for('google');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools,
});

await agent.run('Draft an email to alice@example.com about the project update');
await agent.run('Create a calendar event for next Tuesday at 2pm with Google Meet');
await agent.run('Search my Drive for the Q4 report');
```

| Tool | Description | Risk |
|------|-------------|------|
| `create_draft_email` | Create a draft email in Gmail, optionally as a reply | medium |
| `send_email` | Send an email or reply via Gmail with HTML body support | medium |
| `create_meeting` | Create Google Calendar event with optional Google Meet link | medium |
| `edit_meeting` | Update an existing Google Calendar event | medium |
| `get_meeting` | Get full details of a single calendar event | low |
| `list_meetings` | List calendar events in a time window | low |
| `find_meeting_slots` | Find available time slots via Google freeBusy API | low |
| `get_meeting_transcript` | Retrieve Google Meet transcript from Drive | low |
| `read_file` | Read a file from Google Drive as markdown (Docs, Sheets, Slides, PDF, images) | low |
| `list_files` | List files/folders in Google Drive | low |
| `search_files` | Full-text search across Google Drive | low |

**Authentication modes:**

| Mode | `userId` param | When to use |
|------|---------------|-------------|
| **OAuth (delegated)** | User's identity | User signs in via Google OAuth. Tools access the signed-in user's Gmail/Calendar/Drive. |
| **Service Account** | Service account email | Server-to-server access. `targetUser` parameter in tools for domain-wide delegation. |

**Key patterns:**
- `googleFetch()` helper handles OAuth and service account auth, JSON encoding, error parsing, and multi-account awareness
- Google-native file formats (Docs, Sheets, Slides) are exported to markdown/CSV automatically in `read_file`
- `isServiceAccountAuth()` checks connector auth type to determine path prefix behavior
- All tools accept optional `targetUser` parameter for service account impersonation

### Zoom Connector Tools

3 tools for Zoom meeting management, auto-registered via `ConnectorTools.for('zoom')`:

```typescript
import { createConnectorFromTemplate, ConnectorTools } from '@everworker/oneringai';

// OAuth User Token
createConnectorFromTemplate('my-zoom', 'zoom', 'oauth-user', {
  clientId: process.env.ZOOM_CLIENT_ID!,
  redirectUri: 'http://localhost:3000/callback',
});

// Or Server-to-Server OAuth
createConnectorFromTemplate('zoom-s2s', 'zoom', 'server-to-server', {
  clientId: process.env.ZOOM_S2S_CLIENT_ID!,
  clientSecret: process.env.ZOOM_S2S_CLIENT_SECRET!,
  accountId: process.env.ZOOM_ACCOUNT_ID!,
});
```

| Tool | Description | Risk |
|------|-------------|------|
| `zoom_create_meeting` | Create instant or scheduled Zoom meeting. Returns join URL, start URL, password. | medium |
| `zoom_update_meeting` | Update meeting settings (topic, time, duration, waiting room, join-before-host) | medium |
| `zoom_get_transcript` | Download and parse cloud recording transcript (VTT → structured speaker-attributed text) | low |

**Key patterns:**
- `zoomFetch()` helper with query param support, error handling, and 204 No Content handling
- `parseMeetingId()` extracts meeting ID from URL (`https://zoom.us/j/123...`) or raw numeric ID
- `parseVTT()` parses WebVTT transcript into structured `TranscriptEntry[]` with speaker, timestamps, and text

### Unified Calendar Tool

Cross-provider meeting slot finder that aggregates busy intervals from multiple calendar backends (Google, Microsoft):

```typescript
import { tools } from '@everworker/oneringai';

// Create providers from existing connectors
const googleProvider = tools.createGoogleCalendarSlotsProvider(googleConnector);
const msftProvider = tools.createMicrosoftCalendarSlotsProvider(msftConnector);

// Unified tool checks all providers in parallel
const tool = tools.createUnifiedFindMeetingSlotsTool([googleProvider, msftProvider]);

const result = await tool.execute({
  attendees: ['alice@gmail.com', 'bob@outlook.com'],
  startDateTime: '2026-04-15T08:00:00',
  endDateTime: '2026-04-15T18:00:00',
  duration: 30,
  timeZone: 'America/New_York',
  maxResults: 5,
  // Optional: route attendees to specific providers
  attendeeMapping: {
    'alice@gmail.com': 'Google',
    'bob@outlook.com': 'Microsoft',
  },
});
// result.slots: MeetingSlotSuggestion[] — times when ALL attendees are free
```

The `ICalendarSlotsProvider` interface is extensible — implement it for any calendar backend:

```typescript
interface ICalendarSlotsProvider {
  readonly name: string;
  execute(args: GetBusyIntervalsArgs): Promise<GetBusyIntervalsResult>;
}
```

### Multi-Account Connectors

Use multiple accounts per connector (e.g., work + personal Microsoft accounts) with automatic account resolution:

```typescript
import { Agent, Connector, Vendor } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  identities: [
    { connector: 'microsoft', accountId: 'work' },
    { connector: 'microsoft', accountId: 'personal' },
    { connector: 'google', accountId: 'main', toolFilter: ['send_email', 'read_file'] },
  ],
});
```

**How it works:**

1. Each identity generates its own set of tools via `ConnectorTools.for(connector, { accountId })`
2. Tools are registered with source metadata (e.g., `connector:microsoft:work`) for identity filtering
3. `toolFilter` (optional) restricts which tools are generated per identity
4. Account resolution follows a 4-tier priority:
   - Explicit `accountId` from `ConnectorTools.for({ accountId })` (highest)
   - `context.accountId` already set on `ToolContext`
   - `context.connectorAccounts[connectorName]` per-connector binding map
   - `undefined` — legacy path, no binding

**OAuth account management:**

```typescript
// Re-key a temporary account ID to a stable one (e.g., after discovering email)
await connector.rekeyAccount('user-123', 'temp-abc', 'alice@work.com');

// Remove an account
await connector.removeAccount('user-123', 'personal');

// List all accounts for a user
const accounts = await connector.listAccounts('user-123');
```

---

## Dynamic Tool Management

Control tools at runtime for all agent types. Enable, disable, organize, and select tools dynamically.

### Unified Tool Management Architecture

**AgentContextNextGen is the single source of truth** for ToolManager. All agents access tools through a single ToolManager instance owned by the context:

- `agent.tools === agent.context.tools` - Same ToolManager instance
- Tool changes via either API are immediately reflected in the other
- No duplicate tool storage or sync issues

### Quick Start

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool, emailTool, databaseTool],
});

// UNIFIED: agent.tools and agent.context.tools are the SAME instance
console.log(agent.tools === agent.context.tools);  // true

// Disable tool temporarily
agent.tools.disable('database_tool');

// Changes via agent.context.tools are immediately reflected
agent.context.tools.enable('database_tool');
console.log(agent.tools.listEnabled().includes('database_tool'));  // true

// Run without database access
agent.tools.disable('database_tool');
await agent.run('Check weather and email me');

// Re-enable later
agent.tools.enable('database_tool');
```

### ToolManager API

Every agent has a `tools` property that returns the ToolManager owned by the context. Both `agent.tools` and `agent.context.tools` return the same instance:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tool1, tool2],
});

// UNIFIED: Both access paths return the same ToolManager instance
console.log(agent.tools === agent.context.tools);  // true

// Access ToolManager via either path
const toolManager = agent.tools;
// OR: const toolManager = agent.context.tools;  // Same instance!

// Register new tool
toolManager.register(tool3, {
  namespace: 'data',
  priority: 10,
  enabled: true,
});

// Unregister tool
toolManager.unregister('tool_name');

// Enable/disable
toolManager.enable('tool_name');
toolManager.disable('tool_name');

// Check if enabled
const isEnabled = toolManager.isEnabled('tool_name');

// List tools
const all = toolManager.list();           // All tools
const enabled = toolManager.listEnabled(); // Only enabled
```

### Tool Options

```typescript
interface ToolOptions {
  /** Whether the tool is enabled. Default: true */
  enabled?: boolean;

  /** Namespace for grouping related tools. Default: 'default' */
  namespace?: string;

  /** Priority for selection ordering. Higher = preferred. Default: 0 */
  priority?: number;

  /** Conditions for context-aware enabling (all must pass) */
  conditions?: ToolCondition[];

  /** Tags for categorization and search */
  tags?: string[];

  /** Category grouping */
  category?: string;

  /** Source identifier (built-in, connector, custom, mcp, etc.) */
  source?: string;
}

interface ToolCondition {
  type: 'mode' | 'context' | 'custom';
  predicate: (context: ToolSelectionContext) => boolean;
}
```

#### Namespaces

Organize tools by category:

```typescript
// Register tools with namespaces
agent.tools.register(weatherTool, { namespace: 'external-api' });
agent.tools.register(emailTool, { namespace: 'communication' });
agent.tools.register(databaseReadTool, { namespace: 'database' });
agent.tools.register(databaseWriteTool, { namespace: 'database' });

// Disable all database tools
agent.tools.disableNamespace('database');
```

#### Priority

Control tool selection order:

```typescript
agent.tools.register(primaryWeatherTool, {
  priority: 100,  // High priority
});

agent.tools.register(fallbackWeatherTool, {
  priority: 10,   // Low priority (fallback)
});

// LLM sees high-priority tools first
```

#### Conditions

Dynamic enabling based on context:

```typescript
agent.tools.register(adminTool, {
  conditions: [
    { type: 'custom', predicate: (context) => context.custom?.role === 'admin' },
  ],
});

// Tool only available when condition is met
const selected = agent.tools.selectForContext({
  custom: { role: 'admin' },
});
```

### Context-Aware Selection

```typescript
interface ToolSelectionContext {
  /** Current user input or task description */
  input?: string;

  /** Current agent mode (for UniversalAgent) */
  mode?: string;

  /** Current task name (for TaskAgent) */
  currentTask?: string;

  /** Recently used tools (to avoid repetition) */
  recentTools?: string[];

  /** Token budget for tool definitions */
  tokenBudget?: number;

  /** Custom context data */
  custom?: Record<string, unknown>;
}
```

```typescript
// Select tools based on context
const tools = agent.tools.selectForContext({
  mode: 'executing',
  custom: { environment: 'production', role: 'admin', permissions: ['write'] },
});

// Only tools matching context are selected
```

### State Persistence

Save and restore tool configuration:

```typescript
// Get current state
const state = agent.tools.getState();

// Save to file
await fs.writeFile('./tool-config.json', JSON.stringify(state));

// Later... load state
const savedState = JSON.parse(await fs.readFile('./tool-config.json', 'utf-8'));
agent.tools.loadState(savedState);

// All tool registrations, priorities, and enabled states restored
```

### Events

Listen to tool changes:

```typescript
agent.tools.on('tool:registered', ({ name, namespace, enabled }) => {
  console.log(`Tool registered: ${name} (namespace: ${namespace}, enabled: ${enabled})`);
});

agent.tools.on('tool:unregistered', ({ name }) => {
  console.log(`Tool unregistered: ${name}`);
});

agent.tools.on('tool:enabled', ({ name }) => {
  console.log(`Tool enabled: ${name}`);
});

agent.tools.on('tool:disabled', ({ name }) => {
  console.log(`Tool disabled: ${name}`);
});
```

### Advanced Patterns

#### Environment-Based Tools

```typescript
const isDevelopment = process.env.NODE_ENV === 'development';

agent.tools.register(debugTool, {
  enabled: isDevelopment,
  namespace: 'debug',
});

agent.tools.register(productionTool, {
  enabled: !isDevelopment,
  namespace: 'production',
});
```

#### Permission-Based Tools

```typescript
function createAgentWithPermissions(userRole: string) {
  const agent = Agent.create({
    connector: 'openai',
    model: 'gpt-4.1',
  });

  // Register all tools
  agent.tools.register(readTool, {
    namespace: 'data',
    priority: 100,
  });

  agent.tools.register(writeTool, {
    namespace: 'data',
    priority: 90,
    enabled: userRole === 'admin',  // Only for admins
  });

  agent.tools.register(deleteTool, {
    namespace: 'data',
    priority: 80,
    enabled: userRole === 'super-admin',  // Only for super admins
  });

  return agent;
}
```

#### Rate-Limited Tools

```typescript
class RateLimitedToolManager {
  private calls = new Map<string, number>();
  private limits = new Map<string, number>();

  constructor(private agent: Agent) {}

  registerWithLimit(tool: ToolFunction, limit: number) {
    this.agent.tools.register(tool);
    this.limits.set(tool.definition.function.name, limit);
    this.calls.set(tool.definition.function.name, 0);
  }

  async execute(name: string, args: unknown) {
    const count = this.calls.get(name) || 0;
    const limit = this.limits.get(name);

    if (limit && count >= limit) {
      throw new Error(`Rate limit exceeded for ${name}`);
    }

    this.calls.set(name, count + 1);
    return await this.agent.tools.get(name)?.execute(args);
  }
}
```

#### Dynamic Tool Loading

```typescript
class PluginManager {
  constructor(private agent: Agent) {}

  async loadPlugin(pluginPath: string) {
    const plugin = await import(pluginPath);

    for (const tool of plugin.tools) {
      this.agent.tools.register(tool, {
        namespace: plugin.name,
        category: plugin.name,
      });
    }

    console.log(`Loaded plugin: ${plugin.name}`);
  }

  unloadPlugin(pluginName: string) {
    for (const name of this.agent.tools.getByCategory(pluginName)) {
      this.agent.tools.unregister(name);
    }

    console.log(`Unloaded plugin: ${pluginName}`);
  }
}
```

### Backward Compatibility

The old API still works:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tool1, tool2],  // Still works!
});

// Old methods still work
agent.addTool(tool3);        // Still works!
agent.removeTool('tool1');   // Still works!
agent.setTools([newTools]);  // Still works!
agent.listTools();           // Still works!

// New API via .tools property
agent.tools.disable('tool2');  // NEW!
agent.tools.enable('tool2');   // NEW!
```

### Best Practices

#### 1. Use Namespaces for Organization

```typescript
// Good
agent.tools.register(githubTool, { namespace: 'github' });
agent.tools.register(slackTool, { namespace: 'slack' });
agent.tools.register(databaseTool, { namespace: 'database' });

// Bad
agent.tools.register(githubTool);  // Hard to organize later
```

#### 2. Set Priorities for Fallbacks

```typescript
// Good
agent.tools.register(primaryAPI, { priority: 100 });
agent.tools.register(fallbackAPI, { priority: 50 });

// Bad - no priority, random selection
agent.tools.register(primaryAPI);
agent.tools.register(fallbackAPI);
```

#### 3. Disable Destructive Tools by Default

```typescript
// Good
agent.tools.register(deleteTool, {
  enabled: false,  // Disabled by default
  namespace: 'destructive',
});

// Enable only when needed
function enableDestructiveMode() {
  agent.tools.enable('delete_tool');
}
```

#### 4. Use Conditions for Complex Logic

```typescript
// Good
agent.tools.register(adminTool, {
  conditions: [
    { type: 'custom', predicate: (ctx) => ctx.custom?.role === 'admin' && ctx.custom?.environment === 'production' },
  ],
});

// Bad - manual checking everywhere
if (user.role === 'admin') {
  agent.tools.enable('admin_tool');
} else {
  agent.tools.disable('admin_tool');
}
```

#### 5. Persist Tool State for Sessions

```typescript
// Save tool state with session
const toolState = agent.tools.getState();
session.customData = { ...session.customData, toolState };
await sessionManager.save(session);

// Restore tool state
const loaded = await sessionManager.load(sessionId);
if (loaded?.customData?.toolState) {
  agent.tools.loadState(loaded.customData.toolState);
}
```

### Circuit Breaker Protection

ToolManager includes built-in circuit breaker protection for each tool. When a tool fails repeatedly, the circuit breaker prevents further calls to avoid cascading failures.

```typescript
// Get circuit breaker states for all tools
const states = agent.tools.getCircuitBreakerStates();
// Returns: Map<toolName, 'closed' | 'open' | 'half-open'>

for (const [toolName, state] of states) {
  console.log(`${toolName}: ${state}`);
}

// Get metrics for a specific tool
const metrics = agent.tools.getToolCircuitBreakerMetrics('risky_tool');
console.log(`Successes: ${metrics.successCount}, Failures: ${metrics.failureCount}`);

// Manually reset a circuit breaker
agent.tools.resetToolCircuitBreaker('risky_tool');
```

**Configure circuit breaker per tool:**

```typescript
agent.tools.setCircuitBreakerConfig('external_api', {
  failureThreshold: 3,     // Open after 3 failures
  successThreshold: 2,     // Close after 2 successes in half-open
  resetTimeoutMs: 60000,   // Try half-open after 60s
  windowMs: 300000,        // Track failures in 5 min window
});
```

**Circuit breaker states:**
- **Closed** (normal) - Tool executes normally
- **Open** (tripped) - Tool calls fail immediately without execution
- **Half-Open** (testing) - One call allowed to test recovery

### Tool Execution

ToolManager implements `IToolExecutor` for direct tool execution:

```typescript
// Execute tool directly (used internally by agentic loop)
const result = await agent.tools.execute('get_weather', { location: 'Paris' });

// Execute returns the tool's result or throws on error
```

---

## Async (Non-Blocking) Tools

Some tools take seconds or minutes to complete — web scraping, data analysis, external API calls, sub-agent orchestration. Normally, the agentic loop blocks on every tool call. With async tools (`blocking: false`), the tool executes in the background while the agent continues reasoning.

### How It Works

The lifecycle of an async tool call:

1. **LLM requests tool call** — The agent's agentic loop extracts tool calls from the LLM response as usual
2. **Placeholder returned** — For `blocking: false` tools, a placeholder `tool_result` is returned immediately: *"Tool X is executing asynchronously. The result will be delivered in a follow-up message."*
3. **Background execution** — The tool runs in the background (fire-and-forget promise with timeout)
4. **Loop continues** — The LLM sees the placeholder, can call other (blocking) tools, reason about the situation, or produce text output
5. **Result arrives** — When the async tool completes (or fails/times out), the result is queued
6. **Delivery as user message** — Queued results are batched and injected as a structured user message:
   ```
   [Async Tool Results]
   Tool "analyze_dataset" (call_abc123) completed:
   { "summary": "...", "score": 42 }

   Process these results and continue.
   ```
7. **Continuation** — If `autoContinue: true` (default), the agent re-enters the agentic loop to process the results. If `false`, the caller must invoke `agent.continueWithAsyncResults()`.

### Quick Start

```typescript
import { Agent, ToolFunction } from '@everworker/oneringai';

// 1. Define a tool with blocking: false
const analyzeData: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'analyze_dataset',
      description: 'Run statistical analysis on a large dataset (may take 30+ seconds)',
      parameters: {
        type: 'object',
        properties: {
          dataset: { type: 'string', description: 'Dataset name or path' },
          metrics: { type: 'array', items: { type: 'string' }, description: 'Metrics to compute' },
        },
        required: ['dataset'],
      },
    },
    blocking: false, // <-- Makes this tool async
  },
  execute: async (args) => {
    const data = await loadDataset(args.dataset);
    const results = await computeMetrics(data, args.metrics);
    return { summary: results.summary, rowCount: data.length, metrics: results.values };
  },
};

// 2. Create agent with async config
const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  asyncTools: {
    autoContinue: true,      // Default: auto re-enter loop on result
    batchWindowMs: 1000,     // Batch results within 1s window
    asyncTimeout: 300000,    // 5 min timeout per async tool
  },
  tools: [analyzeData, readFile, writeFile],  // Mix blocking and async tools
});

// 3. Run — async tools are handled automatically
const response = await agent.run('Analyze the Q4 sales dataset and write a summary report');
// The agent will:
// - Call analyze_dataset (async) → gets placeholder
// - Maybe call read_file (blocking) → gets real result
// - Produce intermediate text while waiting
// - When analyze_dataset completes → auto-continue, process results
// - Write the report with writeFile
```

### Auto-Continue vs Manual Mode

#### Auto-Continue (Default)

With `autoContinue: true` (default), the agent re-enters the agentic loop automatically when results arrive:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  asyncTools: { autoContinue: true }, // default
  tools: [asyncTool],
});

// Just run — everything is handled
const response = await agent.run('Do the analysis');
// response.pendingAsyncTools may be non-empty if tools are still running
// when the initial loop ends (no more blocking work to do)
```

The initial `run()` returns when the agentic loop has no more blocking work. If async tools are still pending, `response.pendingAsyncTools` lists them. When they complete, the agent auto-continues in the background.

#### Manual Mode

With `autoContinue: false`, results are queued but the agent doesn't auto-continue. The caller decides when:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  asyncTools: { autoContinue: false },
  tools: [asyncTool],
});

// Listen for completions
agent.on('async:tool:complete', (event) => {
  console.log(`${event.toolName} finished in ${event.duration}ms`);
});

const response = await agent.run('Start the analysis');

// Check what's pending
if (agent.hasPendingAsyncTools()) {
  console.log('Pending:', agent.getPendingAsyncTools().map(p => p.toolName));

  // Wait for results to arrive (via events, polling, or your own logic)
  // Then trigger continuation:
  const continuation = await agent.continueWithAsyncResults();
  console.log(continuation.output_text); // Agent processed the async results
}
```

### Configuration

```typescript
interface AsyncToolConfig {
  /**
   * Auto re-enter agentic loop when async results arrive.
   * @default true
   */
  autoContinue?: boolean;

  /**
   * Batch window in ms. If multiple async tools complete within this window,
   * their results are delivered together in a single user message.
   * @default 500
   */
  batchWindowMs?: number;

  /**
   * Timeout per async tool execution in ms.
   * @default 300000 (5 minutes)
   */
  asyncTimeout?: number;
}
```

Set `blocking: false` on individual tool definitions:

```typescript
const tool: ToolFunction = {
  definition: {
    type: 'function',
    function: { name: 'slow_tool', description: '...', parameters: {} },
    blocking: false, // <-- async
  },
  execute: async (args) => { /* ... */ },
};
```

Tools default to `blocking: true` if not specified.

### Events

Six new events for monitoring async tool lifecycle (a sixth, `async:results:injected` — `{ executionId, iteration, results: [{toolCallId, toolName}], timestamp }` — fires when queued results are injected mid-loop before the next LLM call, in addition to the five below):

| Event | Payload | When |
|-------|---------|------|
| `async:tool:started` | `{ executionId, toolCallId, toolName, args, timestamp }` | Async tool execution begins |
| `async:tool:complete` | `{ executionId, toolCallId, toolName, result, duration, timestamp }` | Tool completed successfully |
| `async:tool:error` | `{ executionId, toolCallId, toolName, error, duration, timestamp }` | Tool threw an error |
| `async:tool:timeout` | `{ executionId, toolCallId, toolName, timeout, timestamp }` | Tool exceeded `asyncTimeout` |
| `async:continuation:start` | `{ executionId, results: [{toolCallId, toolName}], timestamp }` | Agent re-entering loop with results |

```typescript
agent.on('async:tool:started', (e) => {
  console.log(`[ASYNC] ${e.toolName} started (${e.toolCallId})`);
});

agent.on('async:tool:complete', (e) => {
  console.log(`[ASYNC] ${e.toolName} completed in ${e.duration}ms`);
});

agent.on('async:tool:error', (e) => {
  console.error(`[ASYNC] ${e.toolName} failed: ${e.error.message}`);
});

agent.on('async:tool:timeout', (e) => {
  console.warn(`[ASYNC] ${e.toolName} timed out after ${e.timeout}ms`);
});

agent.on('async:continuation:start', (e) => {
  console.log(`[ASYNC] Continuing with ${e.results.length} result(s)`);
});
```

### Public API

```text
// Check if any async tools are still running
agent.hasPendingAsyncTools(): boolean;

// Get details about pending async tools
agent.getPendingAsyncTools(): PendingAsyncTool[];
// PendingAsyncTool: { toolCallId, toolName, args, startTime, status, result?, error? }

// Cancel a specific async tool
agent.cancelAsyncTool(toolCallId: string): void;

// Cancel all pending async tools and clear the result queue
agent.cancelAllAsyncTools(): void;

// Manually trigger continuation with queued results
// (only needed when autoContinue: false)
agent.continueWithAsyncResults(results?: ToolResult[]): Promise<AgentResponse>;

// Response includes pending info
const response = await agent.run('...');
response.pendingAsyncTools; // Array<{ toolCallId, toolName, startTime, status }> | undefined
```

### Mixed Blocking and Async Tools

Blocking and async tools work together naturally in the same iteration:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [
    readFile,           // blocking (default)
    writeFile,          // blocking
    webFetch,           // blocking
    analyzeDataset,     // blocking: false
    generateReport,     // blocking: false
  ],
});

// If the LLM calls both readFile and analyzeDataset in the same turn:
// - readFile executes synchronously, result returned immediately
// - analyzeDataset starts in background, placeholder returned
// - Both results go to context, loop continues
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| **Result arrives during active loop** | Injected as a `[Async Tool Results]` user message at the start of the next iteration of the *same* run — the LLM can see results before `run()` ends, not just via a later continuation. (This mid-loop message omits the `(toolCallId)` and the "Process these results and continue." line used by `continueWithAsyncResults()`.) |
| **All called tools are async** | LLM sees only placeholders → likely produces text → loop ends → results trickle in → auto-continue |
| **Async tool fails** | Error result delivered same as success — LLM sees the error and can react |
| **Async tool times out** | Treated as error with timeout message. Configurable via `asyncTimeout`. |
| **Agent destroyed with pending tools** | `destroy()` cancels all pending async tools and clears timers |
| **Multiple results arrive close together** | Batched within `batchWindowMs` window, delivered as single message |
| **`continueWithAsyncResults()` called with no results** | Throws `"No async results to deliver"` |
| **Concurrent continuations** | Second call throws `"A continuation is already in progress"` |

### Use Cases

- **Long-running analysis** — Data processing, ML inference, report generation
- **Parallel API calls** — Fetch from multiple external services simultaneously
- **Sub-agent orchestration** — Dispatch work to sub-agents without blocking the orchestrator
- **Web scraping** — Scrape multiple pages in parallel while the agent reasons about strategy
- **File processing** — Process large files while the agent works on other tasks

---

## Long-Running Sessions (Suspend/Resume)

Some agentic workflows span hours or days. For example, an agent analyzes data, emails the results to a user, and waits for their reply before continuing. The **Suspend/Resume** feature enables this by letting tools pause the agent loop and external events resume it later.

### How It Works

1. A tool returns a `SuspendSignal` instead of a normal result
2. The agent loop adds the display result to context, does a final wrap-up LLM call
3. Session state (conversation + plugins) is saved automatically
4. A correlation mapping links the external event ID to the session
5. `AgentResponse` returns with `status: 'suspended'` and full metadata
6. Later, `Agent.hydrate()` reconstructs the agent; `run(input)` continues

### Creating a Suspend Tool

```typescript
import { SuspendSignal, ToolFunction } from '@everworker/oneringai';

const sendResultsEmail: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'send_results_email',
      description: 'Email analysis results and wait for user reply',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email' },
          subject: { type: 'string' },
          body: { type: 'string', description: 'Email body with results' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  execute: async (args) => {
    // Perform the side effect
    const { messageId } = await emailService.send(args.to, args.subject, args.body);

    // Return SuspendSignal — agent loop will pause
    return SuspendSignal.create({
      result: `Email sent to ${args.to} (subject: "${args.subject}"). Waiting for reply.`,
      correlationId: `email:${messageId}`,
      metadata: { messageId, sentTo: args.to },
    });
  },
};
```

**SuspendSignal Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `result` | `unknown` | (required) | Tool result visible to the LLM |
| `correlationId` | `string` | (required) | ID for routing external events back (e.g., `email:msg_123`) |
| `resumeAs` | `'user_message' \| 'tool_result'` | `'user_message'` | How external input is injected on resume |
| `ttl` | `number` | 7 days (ms) | Time-to-live before the suspended session expires |
| `metadata` | `Record<string, unknown>` | — | App-specific data (email ID, ticket ID, etc.) |

### Running the Agent

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [sendResultsEmail, analyzeData],
});

const response = await agent.run('Analyze the Q1 sales data and email results to alice@example.com');

if (response.status === 'suspended') {
  console.log('Agent suspended!');
  console.log('Correlation:', response.suspension.correlationId);
  console.log('Session:', response.suspension.sessionId);
  console.log('Expires:', response.suspension.expiresAt);
  // Store the correlation for your webhook handler
}
```

The `AgentResponse.suspension` field contains:

```typescript
interface SuspensionInfo {
  correlationId: string;    // 'email:msg_123'
  sessionId: string;        // Auto-generated or existing session ID
  agentId: string;          // Agent ID for reconstruction
  resumeAs: 'user_message' | 'tool_result';
  expiresAt: string;        // ISO timestamp
  metadata?: Record<string, unknown>;
}
```

### Resuming a Suspended Session

When the external event arrives (e.g., email reply webhook), reconstruct and resume:

```typescript
import { Agent, StorageRegistry } from '@everworker/oneringai';
import type { ICorrelationStorage } from '@everworker/oneringai';

// In your webhook handler
app.post('/webhooks/email-reply', async (req, res) => {
  const { inReplyTo, body } = req.body;

  // 1. Resolve which session this reply belongs to
  const correlationStorage = StorageRegistry.get('correlations') as ICorrelationStorage;
  const ref = await correlationStorage.resolve(`email:${inReplyTo}`);
  if (!ref) {
    return res.status(404).send('Unknown or expired session');
  }

  // 2. Reconstruct agent from stored definition + session
  const agent = await Agent.hydrate(ref.sessionId, {
    agentId: ref.agentId,
  });

  // 3. Customize — add tools, hooks, etc.
  agent.tools.register(sendResultsEmail);
  agent.setLifecycleHooks({ onError: myErrorHandler });

  // 4. Continue with the user's reply
  const result = await agent.run(body);

  if (result.status === 'suspended') {
    // Agent suspended again — another email sent, cycle continues
    console.log('Re-suspended:', result.suspension.correlationId);
  } else {
    console.log('Agent completed:', result.output_text);
  }

  res.status(200).send('OK');
});
```

### `Agent.hydrate()` API

```text
static async hydrate(
  sessionId: string,
  options: {
    agentId: string;
    definitionStorage?: IAgentDefinitionStorage;
    overrides?: Partial<AgentConfig>;
  }
): Promise<Agent>
```

`hydrate()` is a static method that:
1. Loads the agent definition via `Agent.fromStorage(agentId)`
2. Loads the session state (conversation + plugin states) via `loadSession(sessionId)`
3. Cleans up correlation mappings for the session
4. Returns a fully reconstructed `Agent` ready for customization and `run()`

**Prerequisites:** The agent definition must have been saved via `agent.saveDefinition()`, and `StorageRegistry` must have `sessions` configured (or the agent was created with explicit session storage).

### Correlation Storage

By default, correlations are stored as files in `~/.oneringai/correlations/`. Configure a custom backend:

```typescript
import { StorageRegistry, FileCorrelationStorage } from '@everworker/oneringai';

// Use default file-based storage (auto-configured)
// OR configure explicitly:
StorageRegistry.set('correlations', new FileCorrelationStorage({
  baseDirectory: '/custom/path/correlations',
}));

// Or implement ICorrelationStorage for Redis, database, etc.
StorageRegistry.set('correlations', new RedisCorrelationStorage());
```

**ICorrelationStorage interface:**

```typescript
interface ICorrelationStorage {
  save(correlationId: string, ref: SessionRef): Promise<void>;
  resolve(correlationId: string): Promise<SessionRef | null>;
  delete(correlationId: string): Promise<void>;
  exists(correlationId: string): Promise<boolean>;
  listBySession(sessionId: string): Promise<string[]>;
  listByAgent(agentId: string): Promise<CorrelationSummary[]>;
  pruneExpired(): Promise<number>;
  getPath(): string;
}
```

### Multi-Step Workflows

Suspend/resume naturally supports multi-step workflows. Each `run()` can either complete or suspend again:

```typescript
// Step 1: Agent analyzes data, emails results, suspends
const r1 = await agent.run('Analyze Q1 data and email results');
// r1.status === 'suspended' (email sent, waiting for reply)

// Step 2: User replies, agent processes feedback, sends follow-up, suspends
const agent2 = await Agent.hydrate(r1.suspension.sessionId, { agentId });
agent2.tools.register(sendResultsEmail);
const r2 = await agent2.run('Looks good, but also analyze Q2');
// r2.status === 'suspended' (another email sent)

// Step 3: User replies, agent completes
const agent3 = await Agent.hydrate(r2.suspension.sessionId, { agentId });
agent3.tools.register(sendResultsEmail);
const r3 = await agent3.run('Perfect, thanks!');
// r3.status === 'completed'
```

### Events

The agent emits an `execution:suspended` event when suspension occurs:

```typescript
agent.on('execution:suspended', (event) => {
  console.log('Session suspended:', event.sessionId);
  console.log('Correlation:', event.correlationId);
  console.log('Expires:', event.expiresAt);
});
```

### Housekeeping

Expired correlations can be pruned:

```typescript
const correlationStorage = StorageRegistry.get('correlations') as ICorrelationStorage;
const pruned = await correlationStorage.pruneExpired();
console.log(`Pruned ${pruned} expired correlations`);
```

---

## Tool Execution Plugins

The Tool Execution Plugin System provides a pluggable architecture for extending tool execution with custom behavior. This enables applications to add logging, analytics, UI updates, permission prompts, caching, or any custom logic to the tool execution lifecycle.

### Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     ToolManager (existing)                       │
│  - Tool registration                                             │
│  - Tool lookup                                                   │
│  - Circuit breaker per tool                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ToolExecutionPipeline                          │
│  - Orchestrates plugin chain                                     │
│  - Manages execution lifecycle                                   │
│  - Provides execution context                                    │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
    ┌───────────┐       ┌───────────┐       ┌───────────┐
    │  Plugin 1 │       │  Plugin 2 │       │  Plugin N │
    │ (Logging) │       │(Analytics)│       │ (Custom)  │
    └───────────┘       └───────────┘       └───────────┘
```

### Basic Usage

```typescript
import { Agent, LoggingPlugin, type IToolExecutionPlugin } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool],
});

// Add the built-in logging plugin
agent.tools.executionPipeline.use(new LoggingPlugin());

// Now all tool executions will be logged with timing info
const response = await agent.run('What is the weather in Paris?');
```

### Plugin Interface

Every plugin must implement the `IToolExecutionPlugin` interface:

```typescript
interface IToolExecutionPlugin {
  /** Unique plugin name */
  readonly name: string;

  /** Priority (lower = runs earlier in beforeExecute, later in afterExecute). Default: 100 */
  readonly priority?: number;

  /**
   * Called before tool execution.
   * Can modify args, abort execution, or pass through.
   */
  beforeExecute?(ctx: PluginExecutionContext): Promise<BeforeExecuteResult>;

  /**
   * Called after successful tool execution.
   * Can modify the result before returning to caller.
   * Note: Runs in REVERSE priority order for proper unwinding.
   */
  afterExecute?(ctx: PluginExecutionContext, result: unknown): Promise<unknown>;

  /**
   * Called when tool execution fails.
   * Can recover (return a value), re-throw, or transform the error.
   */
  onError?(ctx: PluginExecutionContext, error: Error): Promise<unknown>;

  /** Called when plugin is registered (optional setup) */
  onRegister?(pipeline: IToolExecutionPipeline): void;

  /** Called when plugin is unregistered (optional cleanup) */
  onUnregister?(): void;
}
```

### Execution Context

The `PluginExecutionContext` provides all information about the current tool execution:

```typescript
interface PluginExecutionContext {
  /** Name of the tool being executed */
  toolName: string;

  /** Original arguments (read-only) */
  readonly args: unknown;

  /** Mutable arguments - modify this to change tool input */
  mutableArgs: unknown;

  /** Metadata map for passing data between plugins */
  metadata: Map<string, unknown>;

  /** Timestamp when execution started */
  startTime: number;

  /** The tool function being executed */
  tool: ToolFunction;

  /** Unique ID for this execution (for tracing) */
  executionId: string;
}
```

### BeforeExecute Results

The `beforeExecute` hook can return different values to control execution:

```typescript
type BeforeExecuteResult =
  | void                           // Continue with original args
  | undefined                      // Continue with original args
  | { abort: true; result: unknown } // Abort and return this result
  | { modifiedArgs: unknown };      // Continue with modified args
```

### Creating Custom Plugins

#### Analytics Plugin Example

```typescript
const analyticsPlugin: IToolExecutionPlugin = {
  name: 'analytics',
  priority: 50, // Run early

  async beforeExecute(ctx) {
    // Record start time in metadata
    ctx.metadata.set('analytics:start', Date.now());
    console.log(`[Analytics] Starting ${ctx.toolName}`);
  },

  async afterExecute(ctx, result) {
    const startTime = ctx.metadata.get('analytics:start') as number;
    const duration = Date.now() - startTime;

    // Track metrics
    trackToolUsage({
      tool: ctx.toolName,
      duration,
      executionId: ctx.executionId,
      success: true,
    });

    return result; // Must return the result
  },

  async onError(ctx, error) {
    const startTime = ctx.metadata.get('analytics:start') as number;
    const duration = Date.now() - startTime;

    trackToolUsage({
      tool: ctx.toolName,
      duration,
      executionId: ctx.executionId,
      success: false,
      error: error.message,
    });

    return undefined; // Let error propagate
  },
};

agent.tools.executionPipeline.use(analyticsPlugin);
```

#### Caching Plugin Example

```typescript
const cache = new Map<string, { result: unknown; expiry: number }>();

const cachePlugin: IToolExecutionPlugin = {
  name: 'cache',
  priority: 10, // Run very early to short-circuit

  async beforeExecute(ctx) {
    const key = `${ctx.toolName}:${JSON.stringify(ctx.args)}`;
    const cached = cache.get(key);

    if (cached && cached.expiry > Date.now()) {
      console.log(`[Cache] HIT for ${ctx.toolName}`);
      return { abort: true, result: cached.result };
    }

    ctx.metadata.set('cache:key', key);
    return undefined; // Continue with execution
  },

  async afterExecute(ctx, result) {
    const key = ctx.metadata.get('cache:key') as string;
    if (key) {
      cache.set(key, {
        result,
        expiry: Date.now() + 60000, // 1 minute TTL
      });
      console.log(`[Cache] Stored result for ${ctx.toolName}`);
    }
    return result;
  },
};
```

#### Args Transformation Plugin Example

```typescript
const sanitizePlugin: IToolExecutionPlugin = {
  name: 'sanitize-args',
  priority: 20,

  async beforeExecute(ctx) {
    // Sanitize string arguments
    const args = ctx.mutableArgs as Record<string, unknown>;
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string') {
        args[key] = value.trim().slice(0, 1000); // Trim and limit length
      }
    }
    return { modifiedArgs: args };
  },
};
```

### Pipeline Management

```typescript
// Add a plugin
agent.tools.executionPipeline.use(myPlugin);

// Remove a plugin by name
agent.tools.executionPipeline.remove('my-plugin');

// Check if a plugin is registered
if (agent.tools.executionPipeline.has('logging')) {
  console.log('Logging is enabled');
}

// Get a specific plugin
const loggingPlugin = agent.tools.executionPipeline.get('logging');

// List all registered plugins
const plugins = agent.tools.executionPipeline.list();
console.log('Registered plugins:', plugins.map(p => p.name));
```

### Plugin Priority

Plugins are sorted by priority (lower number = higher priority):

- **beforeExecute**: Runs in priority order (lower first)
- **afterExecute**: Runs in REVERSE priority order (higher first)
- **onError**: Runs in priority order (lower first)

This ensures proper "unwinding" behavior, similar to middleware stacks.

```typescript
// Example priority ordering:
const earlyPlugin: IToolExecutionPlugin = { name: 'early', priority: 10 };
const defaultPlugin: IToolExecutionPlugin = { name: 'default' }; // priority: 100
const latePlugin: IToolExecutionPlugin = { name: 'late', priority: 200 };

// beforeExecute order: early → default → late
// afterExecute order: late → default → early
```

### Built-in Plugins

Note: `ToolManager` automatically registers a `ResultNormalizerPlugin` (name `'result-normalizer'`, priority 0) on every execution pipeline to guarantee tool results are always valid/serializable — the pipeline is never actually empty. Remove it via `agent.tools.executionPipeline.remove('result-normalizer')` if you don't want this behavior, or reconfigure it via `new ResultNormalizerPlugin({ wrapPrimitives, addSuccessField })`.

#### LoggingPlugin

Logs all tool executions with timing and result information:

```typescript
import { LoggingPlugin } from '@everworker/oneringai';

// Use with default settings (debug level)
agent.tools.executionPipeline.use(new LoggingPlugin());

// Configure log level
agent.tools.executionPipeline.use(new LoggingPlugin({
  level: 'debug', // 'trace' | 'debug' | 'info' | 'warn' | 'error'
}));
```

Output example:
```
[Tool] get_weather starting with args: {"location":"Paris"}
[Tool] get_weather completed in 234ms
[Tool] get_weather result: {"temp":72,"conditions":"sunny"}
```

### Use Cases

1. **Logging & Observability**: Track all tool executions for debugging
2. **Analytics**: Measure tool usage, latency, and success rates
3. **Permission Prompts**: Ask for user approval before dangerous tools
4. **Caching**: Cache expensive tool results
5. **Rate Limiting**: Limit tool calls per minute
6. **UI Updates**: Emit events for frontend updates (like browser tool views)
7. **Audit Logging**: Record all tool executions for compliance
8. **Mocking**: Replace tools with mocks for testing
9. **Retry Logic**: Automatically retry failed tool calls
10. **Transformation**: Sanitize inputs or transform outputs

### Frontend UI Integration

A host application can use the plugin system to emit UI updates when browser
or other long-running tools execute:

```typescript
import type { IToolExecutionPlugin, PluginExecutionContext } from '@everworker/oneringai';

export class BrowserUIPlugin implements IToolExecutionPlugin {
  readonly name = 'browser-ui';
  readonly priority = 200; // Run late

  constructor(private options: {
    emitUI: (instanceId: string, content: BrowserUIContent) => void;
    getInstanceId: () => string;
  }) {}

  async beforeExecute(ctx: PluginExecutionContext) {
    if (this.isBrowserTool(ctx.toolName)) {
      ctx.metadata.set('instanceId', this.options.getInstanceId());
    }
  }

  async afterExecute(ctx: PluginExecutionContext, result: unknown) {
    if (this.isBrowserTool(ctx.toolName)) {
      const instanceId = ctx.metadata.get('instanceId') as string;
      const typedResult = result as { success?: boolean; url?: string };

      if (typedResult?.success) {
        this.options.emitUI(instanceId, {
          type: 'display',
          title: 'Browser',
          elements: [{ type: 'browser', instanceId, currentUrl: typedResult.url }],
        });
      }
    }
    return result;
  }

  private isBrowserTool(name: string): boolean {
    return ['browser_navigate', 'browser_reload'].includes(name);
  }
}

// Register with agent
agent.tools.executionPipeline.use(new BrowserUIPlugin({
  emitUI: (id, content) => frontendEvents.emit('browser-ui', { id, content }),
  getInstanceId: () => currentInstanceId,
}));
```

---

## Tool Permissions

The policy-based permission system provides composable policies, per-user rules with argument inspection, and pluggable storage. Permissions are enforced at the ToolManager pipeline level — all tool execution is gated, whether from Agent's agentic loop, direct API calls, or orchestrator workers.

### Architecture Overview

Permission evaluation follows a 3-tier model, checked in this order:

```
┌──────────────────────────────────────────────────────────────┐
│  1. USER RULES PRE-CHECK (highest priority, FINAL)           │
│     Per-user persistent rules with argument conditions.       │
│     When matched: result is FINAL, no further evaluation.     │
│     Specificity-based: more conditions > fewer conditions.    │
├──────────────────────────────────────────────────────────────┤
│  2. PARENT DELEGATION PRE-CHECK (orchestrator workers)       │
│     Parent deny is FINAL — worker cannot override.            │
│     Parent allow does NOT skip worker restrictions.           │
├──────────────────────────────────────────────────────────────┤
│  3. POLICY CHAIN (composable policies)                       │
│     Deny short-circuits immediately.                          │
│     Allow is remembered but does NOT short-circuit.           │
│     All abstain → defaultVerdict (default: 'deny').           │
│                                                              │
│     If deny + needsApproval → APPROVAL FLOW                 │
│     → onApprovalRequired callback                            │
│     → optional persistent rule creation                      │
└──────────────────────────────────────────────────────────────┘
```

Detailed evaluation flow in `PermissionPolicyManager.check()`:

```
PermissionPolicyManager.check(context):
  1. UserPermissionRulesEngine.evaluate()
     → allow? → DONE (skip chain entirely)
     → deny?  → DONE (skip chain entirely)
     → ask?   → approval dialog
     → no match → fall through

  2. Parent delegation (if orchestrator worker)
     → parent deny → DONE
     → parent allow → continue

  3. PolicyChain.evaluate()
     → BlocklistPolicy (pri 5) → AllowlistPolicy (pri 10) → RateLimitPolicy (pri 20)
     → RolePolicy (pri 30) → PathRestrictionPolicy (pri 50) → BashFilterPolicy (pri 50)
     → UrlAllowlistPolicy (pri 50) → SessionApprovalPolicy (pri 90)

  4. If deny + needsApproval → onApprovalRequired callback
     → approved? → cache approval, optionally create persistent rule
     → denied? → optionally create persistent deny rule
```

Key design principles:

- **User rules are supreme** — when a user rule matches, no policy can override it. This guarantees users always have final say.
- **Deny short-circuits** — in the policy chain, a deny verdict stops evaluation immediately. No later policy can override a deny.
- **Allow does NOT short-circuit** — an allow verdict is remembered, but evaluation continues so a later custom policy can still reject the arguments.
- **All abstain depends on construction path** — a directly constructed `PolicyChain` defaults to deny. `Agent.create()` currently builds its chain through `fromConfig()`, which defaults to deny when an approval callback exists and allow otherwise. Its `permissions.policyChain` field is not applied in 1.0.

### Quick Start

#### Zero-Config (Backward Compatible)

The permission system is always active. Without configuration, default-allowlisted tools execute immediately. A tool declaring `scope: 'session'` or `scope: 'once'` requires approval; because no callback exists in this example, that call is rejected with “Approval required but no approval handler configured.” Use `autoApproveAll: true` only for trusted non-interactive automation.

```typescript
import { Agent, Connector, Vendor } from '@everworker/oneringai';

Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// No permissions config — uses DEFAULT_ALLOWLIST.
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [readFile, writeFile, bash],
});
// read_file: auto-allowed (in DEFAULT_ALLOWLIST)
// write_file: approval required; rejected because no callback is configured
// bash: approval required on every call; rejected for the same reason
```

#### Simple Policy Configuration

Configure public allow/block lists and an approval callback:

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  permissions: {
    // Allowlist is auto-merged with DEFAULT_ALLOWLIST
    allowlist: ['my_safe_tool'],
    blocklist: ['dangerous_tool'],

    // Approval callback — invoked when a tool needs user approval
    onApprovalRequired: async (ctx) => {
      console.log(`Tool '${ctx.toolName}' needs approval. Args:`, ctx.args);
      // In a real app, show a UI dialog
      return { approved: true, scope: 'session' };
    },

  },
});
```

For argument-aware path, command, URL, role, or rate-limit rules, pass your own
public `IPermissionPolicy` implementation through `permissions.policies`. The
source tree contains policies with names such as `PathRestrictionPolicy` and
`BashFilterPolicy`, but those concrete classes are not exported from the
published package root in 1.0.0; examples importing them from
`@everworker/oneringai` do not compile.

### Per-User Permission Rules

User permission rules are persistent, per-user, and have the highest evaluation priority. When a user rule matches, its result is final — no policy can override it.

#### UserPermissionRule Model

```typescript
interface UserPermissionRule {
  /** Unique rule ID (UUID) */
  id: string;

  /** Tool name this rule applies to. Use '*' for all tools. */
  toolName: string;

  /** What to do when this rule matches */
  action: 'allow' | 'deny' | 'ask';

  /**
   * Argument conditions (optional). ALL conditions must match (AND logic).
   * If empty/omitted, rule applies to ALL calls of this tool (blanket rule).
   */
  conditions?: ArgumentCondition[];

  /**
   * If true, this rule is absolute — more specific rules CANNOT override it.
   * "Allow bash unconditionally" means even a "bash + rm -rf → ask" rule is ignored.
   * @default false
   */
  unconditional?: boolean;

  /** Whether this rule is active */
  enabled: boolean;

  /** Human-readable description (shown in settings UI) */
  description?: string;

  /** How this rule was created */
  createdBy: 'user' | 'approval_dialog' | 'admin' | 'system';

  /** ISO timestamp of creation */
  createdAt: string;

  /** ISO timestamp of last update */
  updatedAt: string;

  /** Optional expiry (ISO timestamp). Null/undefined = never expires. */
  expiresAt?: string | null;
}
```

#### ArgumentCondition Operators

All 8 operators for inspecting argument values:

```typescript
interface ArgumentCondition {
  /** Argument name to inspect (e.g., 'command', 'path', 'url') */
  argName: string;

  /** Comparison operator */
  operator: ConditionOperator;

  /** Value to compare against. For 'matches'/'not_matches', a regex string. */
  value: string;

  /** Case-insensitive comparison. @default true */
  ignoreCase?: boolean;
}

type ConditionOperator =
  | 'starts_with'    // value starts with the given string
  | 'not_starts_with'
  | 'contains'       // value contains the given string
  | 'not_contains'
  | 'equals'         // exact equality
  | 'not_equals'
  | 'matches'        // regex match
  | 'not_matches';   // regex negation
```

Examples of each operator:

```jsonc
// Allow bash only for npm commands
{ argName: 'command', operator: 'starts_with', value: 'npm' }

// Deny commands containing 'sudo'
{ argName: 'command', operator: 'contains', value: 'sudo' }

// Allow write_file only for .ts files
{ argName: 'path', operator: 'matches', value: '\\.ts$' }

// Deny web_fetch for non-HTTPS URLs
{ argName: 'url', operator: 'not_starts_with', value: 'https://' }

// Allow edit_file only for a specific file
{ argName: 'file_path', operator: 'equals', value: '/workspace/config.json' }

// Deny bash commands matching dangerous patterns
{ argName: 'command', operator: 'not_matches', value: 'rm\\s+-rf|dd\\s+if=|mkfs' }
```

#### Specificity Resolution

When multiple rules match a tool call, specificity determines the winner:

1. **Unconditional rules** are checked first. If matched, they are FINAL — no other rule can override them.
2. **Conditional rules** are ranked by number of matching conditions. More conditions = more specific = higher priority.
3. **Blanket rules** (no conditions) are the fallback with specificity 0.
4. **Ties** are broken by `updatedAt` — most recently updated rule wins.

```typescript
// Example: these rules coexist without conflict
const rules: UserPermissionRule[] = [
  // Blanket: allow bash by default (specificity: 0)
  { id: '1', toolName: 'bash', action: 'allow', enabled: true,
    createdBy: 'user', createdAt: '...', updatedAt: '...' },

  // Conditional: ask before rm commands (specificity: 1, overrides blanket)
  { id: '2', toolName: 'bash', action: 'ask',
    conditions: [{ argName: 'command', operator: 'contains', value: 'rm' }],
    enabled: true, createdBy: 'user', createdAt: '...', updatedAt: '...' },

  // More specific: deny rm -rf (specificity: 2, overrides the 'ask' above)
  { id: '3', toolName: 'bash', action: 'deny',
    conditions: [
      { argName: 'command', operator: 'contains', value: 'rm' },
      { argName: 'command', operator: 'contains', value: '-rf' },
    ],
    enabled: true, createdBy: 'user', createdAt: '...', updatedAt: '...' },
];
```

#### Meta-Arguments

Use special `__` prefixed argument names to match against tool registration metadata instead of call arguments:

| Meta-Arg | Matches Against |
|----------|----------------|
| `__toolCategory` | Tool's registered category (e.g., `filesystem`, `web`, `shell`) |
| `__toolSource` | Tool's source (e.g., `built-in`, `connector:github`, `mcp`, `custom`) |
| `__toolNamespace` | Tool's registered namespace |

```jsonc
// Deny all MCP tools
{
  id: '1', toolName: '*', action: 'deny',
  conditions: [{ argName: '__toolSource', operator: 'starts_with', value: 'mcp' }],
  enabled: true, createdBy: 'admin', createdAt: '...', updatedAt: '...',
}

// Allow only filesystem category tools
{
  id: '2', toolName: '*', action: 'allow',
  conditions: [{ argName: '__toolCategory', operator: 'equals', value: 'filesystem' }],
  enabled: true, createdBy: 'admin', createdAt: '...', updatedAt: '...',
}

// Block all desktop tools
{
  id: '3', toolName: '*', action: 'deny',
  conditions: [{ argName: '__toolCategory', operator: 'equals', value: 'desktop' }],
  enabled: true, createdBy: 'user', createdAt: '...', updatedAt: '...',
}
```

#### CRUD API

Manage rules programmatically via the `UserPermissionRulesEngine`:

```typescript
const engine = agent.policyManager.userRules;

// Add a rule
await engine.addRule({
  id: crypto.randomUUID(),
  toolName: 'bash',
  action: 'ask',
  conditions: [{ argName: 'command', operator: 'contains', value: 'rm' }],
  enabled: true,
  description: 'Ask before any rm commands',
  createdBy: 'user',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}, userId);

// Update a rule
await engine.updateRule(ruleId, { action: 'deny' }, userId);

// Remove a rule
await engine.removeRule(ruleId, userId);

// Get all rules
const allRules = engine.getRules();

// Get rules for a specific tool
const bashRules = engine.getRulesForTool('bash');

// Get a single rule by ID
const rule = engine.getRule(ruleId);

// Enable/disable a rule
await engine.enableRule(ruleId, userId);
await engine.disableRule(ruleId, userId);
```

Rules auto-save to storage (if configured) after every mutation. Expired rules (past `expiresAt`) are automatically cleaned on evaluation.

### Approval Dialog Integration

When a policy denies a tool call with `needsApproval: true`, the `onApprovalRequired` callback is invoked. This is where your application shows an approval UI.

#### Full Approval Callback Example

```typescript
import type { ApprovalRequestContext, ApprovalDecision } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  permissions: {
    onApprovalRequired: async (ctx: ApprovalRequestContext): Promise<ApprovalDecision> => {
      // ctx contains rich context for the approval dialog
      console.log(`Tool: ${ctx.toolName}`);
      console.log(`Risk level: ${ctx.riskLevel}`);
      console.log(`Arguments:`, ctx.args);
      console.log(`Reason: ${ctx.decision.reason}`);
      console.log(`Policy: ${ctx.decision.policyName}`);

      if (ctx.approvalMessage) {
        console.log(`Message: ${ctx.approvalMessage}`);
      }
      if (ctx.sensitiveArgs) {
        console.log(`Sensitive args: ${ctx.sensitiveArgs.join(', ')}`);
      }

      // Show your UI dialog here...
      const userChoice = await showApprovalDialog(ctx);

      if (userChoice === 'allow_once') {
        return { approved: true, scope: 'once' };
      }

      if (userChoice === 'allow_session') {
        return { approved: true, scope: 'session' };
      }

      if (userChoice === 'always_allow') {
        return {
          approved: true,
          scope: 'always',
          remember: true,  // creates a persistent user rule
        };
      }

      if (userChoice === 'always_allow_with_conditions') {
        return {
          approved: true,
          createRule: {
            description: 'Allow write_file in /workspace',
            conditions: [
              { argName: 'path', operator: 'starts_with', value: '/workspace/' },
            ],
          },
        };
      }

      if (userChoice === 'deny_forever') {
        return {
          approved: false,
          scope: 'never',
          remember: true,  // creates a persistent deny rule
        };
      }

      return { approved: false, reason: 'User denied' };
    },
  },
});
```

#### ApprovalRequestContext Fields

The callback receives a rich context extending `PolicyContext`:

```typescript
interface ApprovalRequestContext extends PolicyContext {
  /** The deny decision that triggered this approval request */
  decision: PolicyDecision;

  /** Tool's risk level (from tool permission config or default) */
  riskLevel: RiskLevel;  // 'low' | 'medium' | 'high' | 'critical'

  /** Custom approval message (from tool permission config) */
  approvalMessage?: string;

  /** Argument names to highlight as sensitive in approval UI */
  sensitiveArgs?: string[];

  /** Policy-provided approval scope key */
  approvalKey?: string;

  /** Suggested approval scope */
  approvalScope?: 'once' | 'session' | 'persistent';
}
```

The base `PolicyContext` provides:

```typescript
interface PolicyContext {
  toolName: string;                      // Tool being invoked
  args: Record<string, unknown>;         // Parsed arguments
  userId?: string;                       // From ToolContext.userId
  roles?: string[];                      // From agent config userRoles
  agentId?: string;
  parentAgentId?: string;                // For orchestrator workers
  sessionId?: string;
  iteration?: number;                    // Agentic loop iteration
  executionId?: string;                  // For tracing
  toolSource?: string;                   // built-in, connector:xxx, mcp, custom
  toolCategory?: string;                 // filesystem, web, shell, etc.
  toolNamespace?: string;
  toolTags?: string[];
  toolPermissionConfig?: ToolPermissionConfig;  // Merged tool + registration config
}
```

#### ApprovalDecision with createRule

When the user wants to remember their decision, include `createRule` in the response:

```typescript
interface ApprovalDecision {
  approved: boolean;
  scope?: PermissionScope;   // 'once' | 'session' | 'always' | 'never'
  reason?: string;           // Reason for denial
  approvedBy?: string;       // Identifier of approver
  remember?: boolean;        // Create persistent rule (shorthand)

  /** Explicit rule creation with argument conditions */
  createRule?: {
    description?: string;
    conditions?: ArgumentCondition[];
    expiresAt?: string | null;   // ISO timestamp, null = never
    unconditional?: boolean;
  };
}
```

#### Approval-to-Rule Creation Flow

When the user approves with `createRule` or `remember: true`, the system automatically creates a persistent `UserPermissionRule`:

```
User clicks "Always Allow" in dialog
    ↓
ApprovalDecision { approved: true, remember: true, scope: 'always' }
    ↓
PermissionPolicyManager.createRuleFromApproval()
    ↓
UserPermissionRulesEngine.addRule({
  toolName, action: 'allow', createdBy: 'approval_dialog'
})
    ↓
Rule persisted to IUserPermissionRulesStorage
    ↓
Next call: user rule matches → immediate allow (no policy chain, no dialog)
```

### Policy Implementations and the Public 1.0 Surface

The policy engine contains eight implementations, sorted by priority (lower
number runs first). The published 1.0 package exposes allowlist, blocklist, and
session-approval behavior through `Agent.create({ permissions })` and manager
shortcuts. It exports `IPermissionPolicy`, so applications can add custom
policies. It does **not** export the eight concrete policy classes from the
package root. The five advanced class descriptions below document current
engine behavior and source-level configuration, but their constructors are not
a supported npm import in 1.0.0.

#### AllowlistPolicy

Auto-allows tools by name. Returns `allow` for listed tools, `abstain` for others. Note: allow does NOT short-circuit, so later policies (e.g., BashFilterPolicy) can still deny based on arguments.

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  permissions: {
    // Merged with DEFAULT_ALLOWLIST by PermissionPolicyManager.fromConfig().
    allowlist: ['my_safe_tool', 'another_safe_tool'],
  },
});
```

| Property | Value |
|----------|-------|
| Name | `builtin:allowlist` |
| Priority | 10 |
| Verdict | `allow` or `abstain` |

Default allowlisted tools: `read_file`, `glob`, `grep`, `list_directory`, `store_get`, `store_set`, `store_delete`, `store_list`, `store_action`, `context_stats`, `todo_add`, `todo_update`, `todo_remove`, `tool_catalog_search`, `tool_catalog_load`, `tool_catalog_unload`, `_start_planning`, `_modify_plan`, `_report_progress`, `_request_approval`.

Runtime modification:

```typescript
agent.policyManager.allowlistAdd('my_tool');
agent.policyManager.allowlistRemove('my_tool');
```

#### BlocklistPolicy

Permanently blocks tools by name. Returns `deny` without `needsApproval` — no user approval can override a blocklisted tool. Runs at the highest policy priority to block before any other policy can allow.

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  permissions: { blocklist: ['dangerous_tool', 'deprecated_tool'] },
});
```

| Property | Value |
|----------|-------|
| Name | `builtin:blocklist` |
| Priority | 5 (runs before allowlist) |
| Verdict | `deny` (hard block) or `abstain` |

Runtime modification:

```typescript
agent.policyManager.blocklistAdd('bad_tool');   // also removes from allowlist
agent.policyManager.blocklistRemove('bad_tool');
```

#### SessionApprovalPolicy

Manages session-level approval caching based on tool self-declarations. Reads `PolicyContext.toolPermissionConfig` to determine behavior:

- `scope: 'always'` — auto-allow (tool declares itself safe)
- `scope: 'never'` — hard deny (tool is disabled)
- `scope: 'session'` — check approval cache, deny with `needsApproval` if not cached
- `scope: 'once'` — always deny with `needsApproval` for every call
- No config — `abstain` (tool has no permission declaration)

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  permissions: {
    defaultScope: 'once',
    onApprovalRequired: async (request) => showApprovalDialog(request),
  },
});
```

| Property | Value |
|----------|-------|
| Name | `builtin:session-approval` |
| Priority | 90 (runs late, after argument-inspecting policies) |
| Verdict | `allow`, `deny` (with or without `needsApproval`), or `abstain` |

Approval cache management:

```typescript
// Programmatically approve a tool for the session
agent.policyManager.approve('write_file', {
  scope: 'session',
  approvedBy: 'admin',
});

// With TTL expiration
agent.policyManager.approve('bash', {
  scope: 'session',
  ttlMs: 300000, // 5 minutes
});

// Revoke an approval
agent.policyManager.revoke('write_file');

// Check cache
agent.policyManager.isApproved('write_file'); // true/false

// Clear all session approvals
agent.policyManager.clearSession();
```

#### PathRestrictionPolicy

Restricts file operations to allowed directory roots. Canonicalizes paths (resolves `..`, normalizes separators, best-effort symlink resolution for existing files).

```text
// Source-level illustration; PathRestrictionPolicy is not a package-root export in 1.0.0.
const policy = new PathRestrictionPolicy({
  // Required: allowed path prefixes (canonicalized at construction)
  allowedPaths: ['/workspace', '/tmp', process.cwd()],

  // Optional: customize which tools are checked
  // Default: write_file, edit_file, read_file, list_directory, glob, grep
  tools: ['write_file', 'edit_file', 'read_file', 'list_directory', 'glob', 'grep'],

  // Optional: which argument names contain file paths
  // Default: path, file_path, target_path, directory, pattern
  pathArgs: ['path', 'file_path', 'target_path', 'directory', 'pattern'],

  // Optional: resolve symlinks for existing files
  resolveSymlinks: true,  // default: true

  // Optional: base path for resolving relative paths
  basePath: process.cwd(),  // default: process.cwd()
});
```

| Property | Value |
|----------|-------|
| Name | `builtin:path-restriction` |
| Priority | 50 |
| Verdict | `deny` (with `needsApproval`, argument-scoped key) or `abstain` |

The policy returns `abstain` for tools not in its list, so non-filesystem tools are unaffected. When denying, it provides an argument-scoped approval key (e.g., `write_file:/workspace/foo.txt`) so users can approve access to specific paths for the session.

#### BashFilterPolicy

Best-effort command filtering for the `bash` tool. Checks deny patterns first (any match = deny), then allow patterns (any match = abstain).

**Important**: This is a guardrail, NOT a sandbox. Shell command obfuscation can bypass string-based filtering. For strong isolation, combine with blocklisting bash by default, path restrictions, or container/sandbox execution.

```text
// Source-level illustration; BashFilterPolicy is not a package-root export in 1.0.0.
const policy = new BashFilterPolicy({
  // Deny patterns (checked first, any match → deny with needsApproval)
  denyPatterns: [
    /rm\s+-rf/,
    /sudo\s+/,
    /chmod\s+777/,
    /curl.*\|.*sh/,     // pipe curl to shell
  ],
  denyCommands: ['shutdown', 'reboot', 'mkfs'],

  // Allow patterns (if matched after deny check, abstain → other policies decide)
  allowPatterns: [/^(ls|cat|echo|pwd|whoami)/],
  allowCommands: ['npm', 'node', 'git', 'tsc', 'npx'],

  // Argument containing the command (default: 'command')
  commandArg: 'command',
});
```

| Property | Value |
|----------|-------|
| Name | `builtin:bash-filter` |
| Priority | 50 |
| Verdict | `deny` (with `needsApproval`, command-scoped key) or `abstain` |

Only applies to the `bash` tool — all other tools get `abstain`. If neither deny nor allow patterns match, the policy abstains and lets other policies decide.

#### UrlAllowlistPolicy

Restricts URL-based tools to allowed domains. Uses proper `URL` parsing (not regex over raw strings). Validates both protocol and hostname.

```text
// Source-level illustration; UrlAllowlistPolicy is not a package-root export in 1.0.0.
const policy = new UrlAllowlistPolicy({
  allowedDomains: [
    'api.github.com',       // exact match (also matches www.api.github.com)
    '.example.com',         // suffix: matches sub.example.com, NOT example.com
    'internal.corp.net',    // exact + subdomains
  ],

  // Optional configuration
  allowedProtocols: ['http:', 'https:'],  // default
  tools: ['web_fetch', 'web_search', 'web_scrape'],  // default
  urlArgs: ['url', 'query', 'target_url'],  // default
});
```

| Property | Value |
|----------|-------|
| Name | `builtin:url-allowlist` |
| Priority | 50 |
| Verdict | `deny` (with `needsApproval`, domain-scoped key) or `abstain` |

Domain matching rules:
- `"example.com"` matches exactly `example.com` and subdomains like `www.example.com`
- `".example.com"` (leading dot) matches `sub.example.com` but NOT `example.com` itself
- `"evil-example.com"` does NOT match `example.com`
- Non-URL arguments (e.g., plain search queries) are silently skipped

#### RolePolicy

Role-based access control. Users can have multiple roles. Deny beats allow across all matched rules.

```text
// Source-level illustration; RolePolicy is not a package-root export in 1.0.0.
const policy = new RolePolicy([
  {
    role: 'admin',
    allowTools: ['*'],  // admins can use everything
  },
  {
    role: 'developer',
    allowTools: ['read_file', 'write_file', 'edit_file', 'bash', 'glob', 'grep'],
    denyTools: ['desktop_mouse_click'],  // no desktop automation
  },
  {
    role: 'viewer',
    allowTools: ['read_file', 'glob', 'grep', 'list_directory'],
    denyTools: ['write_file', 'edit_file', 'bash'],
  },
  {
    role: 'restricted',
    denyTools: ['*'],  // deny everything (overrides any allow from other roles)
  },
]);

// Set user roles on the agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userRoles: ['developer'],  // passed to PolicyContext.roles
  permissions: {
    policies: [policy],
  },
});
```

| Property | Value |
|----------|-------|
| Name | `builtin:role` |
| Priority | 30 |
| Verdict | `allow`, `deny` (hard block, no approval), or `abstain` |

If a user has roles `['developer', 'restricted']`, deny from `restricted` beats allow from `developer`. If no user roles are set, the policy abstains.

#### RateLimitPolicy

Per-tool rate limiting with a sliding window. In-memory only — counters reset on process restart.

```text
// Source-level illustration; RateLimitPolicy is not a package-root export in 1.0.0.
const policy = new RateLimitPolicy({
  limits: {
    'web_fetch': { maxCalls: 10, windowMs: 60_000 },   // 10 per minute
    'bash': { maxCalls: 5, windowMs: 30_000 },          // 5 per 30 seconds
    'web_search': { maxCalls: 20, windowMs: 60_000 },   // 20 per minute
  },

  // Optional: default limit for tools not explicitly configured
  defaultLimit: { maxCalls: 100, windowMs: 60_000 },
});
```

| Property | Value |
|----------|-------|
| Name | `builtin:rate-limit` |
| Priority | 20 |
| Verdict | `deny` (hard block, no approval) or `abstain` |

Rate limit denials are hard blocks — no approval override. The deny reason includes retry timing (e.g., "retry after 12345ms").

```typescript
// Reset counters
policy.reset('web_fetch');  // reset one tool
policy.reset();             // reset all tools
```

For distributed rate limiting across processes, implement a custom `IPermissionPolicy` with external state (e.g., Redis).

### Tool Self-Declaration

Tool authors can declare permission defaults directly on the tool definition. These are read by `SessionApprovalPolicy` via `PolicyContext.toolPermissionConfig`.

#### ToolPermissionConfig Fields

```typescript
interface ToolPermissionConfig {
  /** When approval is required: 'once' | 'session' | 'always' | 'never' */
  scope?: PermissionScope;

  /** Risk classification: 'low' | 'medium' | 'high' | 'critical' */
  riskLevel?: RiskLevel;

  /** Custom message shown in approval UI */
  approvalMessage?: string;

  /** Argument names to highlight as sensitive (also used for audit redaction) */
  sensitiveArgs?: string[];

  /** Expiration time for session approvals (ms) */
  sessionTTLMs?: number;
}
```

#### Declaring on a Tool

```typescript
const myTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'deploy_service',
      description: 'Deploy a service to production',
      parameters: {
        type: 'object',
        properties: {
          service: { type: 'string' },
          environment: { type: 'string' },
        },
        required: ['service', 'environment'],
      },
    },
  },
  execute: async (args) => { /* ... */ },
  permission: {
    scope: 'once',          // require approval every time
    riskLevel: 'critical',
    approvalMessage: 'This will deploy to production. Are you sure?',
    sensitiveArgs: ['environment'],
    sessionTTLMs: 300_000,  // session approvals expire after 5 minutes
  },
};
```

#### Registration-Time Override

Application developers can override tool declarations at registration time:

```typescript
agent.tools.register(myTool, {
  permission: {
    scope: 'session',      // override: approve once per session instead of every call
    riskLevel: 'medium',   // downgrade risk from critical
  },
});
```

The merged config (registration override > tool declaration) is passed to policies as `PolicyContext.toolPermissionConfig`.

#### Default Permissions for Built-in Tool Categories

| Category | Tools | Default Scope | Risk Level |
|----------|-------|--------------|------------|
| Filesystem (read) | read_file, glob, grep, list_directory | `always` | `low` |
| Filesystem (write) | write_file, edit_file | `session` | `medium` |
| Shell | bash | `once` | `high` |
| Web | web_fetch | `session` | `low` |
| Web (connector-provided) | web_search, web_scrape | *(no self-declared permission — falls through to chain default)* | — |
| Desktop (read) | desktop_get_*, desktop_window_list | `always` | `low` |
| Desktop (action) | desktop_mouse_*, desktop_screenshot, desktop_keyboard_key, desktop_window_focus | `session` | `medium` |
| Desktop (input) | desktop_keyboard_type | `session` | `high` |
| Store tools | store_*, context_stats | `always` | `low` |
| Code execution | execute_javascript | `once` | `high` |
| Custom tools meta | custom_tool_save, custom_tool_delete | `session` | `medium` |
| Custom tools meta | custom_tool_test | `once` | `high` |
| Orchestrator | assign_turn, delegate_interactive, send_message, list_agents, destroy_agent | `always` | `low` |
| Meta-tools | _start_planning, _modify_plan, _report_progress, _request_approval | `always` | `low` |

### Storage (Clean Architecture)

The permission system uses Clean Architecture storage interfaces. All storage is optional — the system works entirely in-memory without persistence.

#### IUserPermissionRulesStorage

Stores per-user permission rules:

```typescript
interface IUserPermissionRulesStorage {
  /** Load all rules for a user. Returns null if no rules exist. */
  load(userId: string | undefined): Promise<UserPermissionRule[] | null>;

  /** Save all rules for a user (full replacement). */
  save(userId: string | undefined, rules: UserPermissionRule[]): Promise<void>;

  /** Delete all rules for a user. */
  delete(userId: string | undefined): Promise<void>;

  /** Check if rules exist for a user. */
  exists(userId: string | undefined): Promise<boolean>;

  /** Get storage path (for debugging/display). */
  getPath(userId: string | undefined): string;
}
```

The `userId` parameter is always optional — when `undefined`, implementations default to `'default'` user. Reference storage path: `~/.oneringai/users/<userId>/permission_rules.json`.

```typescript
// Reference implementation — file-based
import { FileUserPermissionRulesStorage } from '@everworker/oneringai';

const storage = new FileUserPermissionRulesStorage();

// Custom implementation
class MongoPermissionRulesStorage implements IUserPermissionRulesStorage {
  async load(userId) { /* query MongoDB */ }
  async save(userId, rules) { /* upsert to MongoDB */ }
  async delete(userId) { /* delete from MongoDB */ }
  async exists(userId) { /* check existence */ }
  getPath(userId) { return `mongodb://permissions/${userId ?? 'default'}`; }
}
```

#### IPermissionAuditStorage

There is currently no built-in persistent audit-storage interface. `PermissionPolicyManager` only exposes the audit trail via events (`permission:allow`, `permission:deny`, `permission:approval_granted`, `permission:approval_denied`, `permission:audit` — see "Event Emission" below). To persist entries yourself, subscribe to `permission:audit` and write `PermissionAuditEntry` objects to your own store:

```typescript
agent.policyManager.on('permission:audit', async (entry: PermissionAuditEntry) => {
  await myAuditLog.record(entry);
});
```

#### IPermissionPolicyStorage

There is no public `IPermissionPolicyStorage` or `PolicyFactoryRegistry` in the
current implementation. Internal policy modules contain factory objects, but
neither those factories nor their definition types are exported from the npm
entry point. Persist your application's own serializable policy configuration
and reconstruct your own `IPermissionPolicy` implementations at startup. The
public allowlist/blocklist/session settings can be persisted as ordinary
`AgentPolicyConfig` data.

#### StorageRegistry Integration

Configure permission storage globally via `StorageRegistry`, or pass directly in the agent config:

```typescript
import { StorageRegistry, FileUserPermissionRulesStorage } from '@everworker/oneringai';

// Global configuration
StorageRegistry.configure({
  permissionRules: (ctx) => new MongoPermissionRulesStorage(ctx?.tenantId),
});

// Or per-agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  permissions: {
    userRulesStorage: new FileUserPermissionRulesStorage(),
    // NOTE: there is no built-in auditStorage/policyStorage config field —
    // persist audit entries yourself via agent.policyManager.on('permission:audit', ...).
  },
});
```

### Orchestrator Delegation

When using the orchestrator pattern, worker agents cannot exceed the permissions of their parent (orchestrator).

#### setParentEvaluator

```typescript
import { createOrchestrator } from '@everworker/oneringai';

// Orchestrator with strict permissions
const orchestrator = await createOrchestrator({
  connector: 'openai',
  model: 'gpt-4.1',
  agentTypes: {
    developer: {
      systemPrompt: 'Write code',
      tools: [readFile, writeFile, bash],
    },
  },
});

// Public manager shortcut: workers inherit this hard restriction.
orchestrator.policyManager.blocklistAdd('bash');
// For argument-aware restrictions, add your own IPermissionPolicy implementation.
```

Delegation rules:
- **Parent deny is FINAL** — worker cannot override a parent deny, even with its own user rules.
- **Parent allow does NOT skip worker restrictions** — a worker's own custom policies still run.
- **Parent approval callback is NOT invoked** during delegation check — only the worker's approval callback triggers.

Programmatic delegation for custom agent hierarchies:

```typescript
import { PermissionPolicyManager } from '@everworker/oneringai';

const parentManager = PermissionPolicyManager.fromConfig({ /* parent policies */ });
const workerManager = PermissionPolicyManager.fromConfig({ /* worker policies */ });

// Worker cannot exceed parent permissions
workerManager.setParentEvaluator(parentManager);

// Check parent
const parent = workerManager.getParentEvaluator(); // PermissionPolicyManager | undefined
```

### Audit Trail

Every permission check is recorded as a `PermissionAuditEntry` with centralized argument redaction.

#### PermissionAuditEntry Format

```typescript
interface PermissionAuditEntry {
  id: string;                    // Unique entry ID (UUID)
  timestamp: string;             // ISO timestamp
  toolName: string;              // Tool that was checked
  decision: 'allow' | 'deny';   // Policy evaluation result
  finalOutcome:                  // Final execution outcome
    | 'executed'                 // Tool was allowed and executed
    | 'blocked'                  // Tool was hard-blocked
    | 'approval_granted'         // User approved via dialog
    | 'approval_denied';         // User denied via dialog
  reason: string;                // Human-readable reason
  policyName?: string;           // Policy that made the deciding verdict
  userId?: string;               // User who triggered the check
  agentId?: string;              // Agent that triggered the check
  args?: Record<string, unknown>; // Redacted arguments
  executionId?: string;          // Execution ID for correlation
  approvalRequired?: boolean;    // Whether approval was requested
  approvalKey?: string;          // Approval cache key
  metadata?: Record<string, unknown>;
}
```

#### Centralized Redaction

Arguments are automatically redacted before inclusion in audit entries. Three layers of protection:

1. **Tool-declared `sensitiveArgs`** — argument names listed in `ToolPermissionConfig.sensitiveArgs` are replaced with `[REDACTED]`.
2. **Built-in sensitive keys** — arguments with names matching common secret patterns are replaced with `[REDACTED]`: `token`, `password`, `secret`, `authorization`, `apikey`, `api_key`, `credential`, `private_key`, `access_token`, `refresh_token`, `client_secret`, `passphrase`, `key`.
3. **Truncation** — string values longer than 500 characters are truncated with `...[truncated]`.

#### Event Emission

The `PermissionPolicyManager` emits events for every decision:

```typescript
const manager = agent.policyManager;

manager.on('permission:allow', (entry: PermissionAuditEntry) => {
  console.log(`Allowed: ${entry.toolName} by ${entry.policyName}`);
});

manager.on('permission:deny', (entry: PermissionAuditEntry) => {
  console.log(`Denied: ${entry.toolName} — ${entry.reason}`);
});

manager.on('permission:approval_granted', (entry: PermissionAuditEntry) => {
  console.log(`Approved by user: ${entry.toolName}`);
});

manager.on('permission:approval_denied', (entry: PermissionAuditEntry) => {
  console.log(`User denied: ${entry.toolName}`);
});

// Catch-all audit event (fires for EVERY decision, in addition to specific events)
manager.on('permission:audit', (entry: PermissionAuditEntry) => {
  myAuditLog.record(entry);
});

// Policy lifecycle events
manager.on('policy:added', ({ name }) => console.log(`Policy added: ${name}`));
manager.on('policy:removed', ({ name }) => console.log(`Policy removed: ${name}`));
manager.on('session:cleared', () => console.log('Session approvals cleared'));
```

There is no built-in audit storage — persistence is entirely up to the caller. Subscribe to `permission:audit` (or the more specific `permission:allow`/`permission:deny`/etc. events) and write entries to your own store; do this fire-and-forget so a storage failure never blocks tool execution.

### Migration from Legacy System

The original `ToolPermissionManager` is deprecated. The new `PermissionPolicyManager` is fully backward compatible.

#### ToolPermissionManager to PermissionPolicyManager

The legacy config is automatically translated when passed to `Agent.create()`:

| Legacy Config | Policy Translation |
|--------------|-------------------|
| `blocklist: [...]` | `BlocklistPolicy` |
| `allowlist: [...]` | `AllowlistPolicy` (merged with `DEFAULT_ALLOWLIST`) |
| `defaultScope: 'once'` | `SessionApprovalPolicy('once')` |
| `onApprovalRequired: fn` | Passed through unchanged (same callback signature in both configs) |

`Agent.create()` always routes permission config through `PermissionPolicyManager.fromConfig()` — there is no separate "legacy" vs "policy" code path. `fromConfig()` first applies the legacy translation (blocklist/allowlist/defaultScope/onApprovalRequired) unconditionally, then layers on any explicitly supplied `policies`.

```typescript
import { FileUserPermissionRulesStorage } from '@everworker/oneringai';
import type { IPermissionPolicy } from '@everworker/oneringai';

const noSudoPolicy: IPermissionPolicy = {
  name: 'app:no-sudo',
  priority: 50,
  evaluate: (ctx) =>
    ctx.toolName === 'bash' && String(ctx.args.command ?? '').includes('sudo')
      ? { verdict: 'deny', reason: 'sudo is disabled', policyName: 'app:no-sudo' }
      : { verdict: 'abstain', reason: 'not applicable', policyName: 'app:no-sudo' },
};

// Legacy config — still works, auto-translated to policies
const legacyAgent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  permissions: {
    defaultScope: 'session',
    allowlist: ['my_tool'],
    blocklist: ['bad_tool'],
    onApprovalRequired: async (ctx) => ({ approved: true }),
  },
});
legacyAgent.permissions.approve('tool');  // ToolPermissionManager (deprecated)

// New policy config — explicitly uses policies
const policyAgent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  permissions: {
    allowlist: ['my_tool'],
    blocklist: ['bad_tool'],
    policies: [noSudoPolicy],
    onApprovalRequired: async (ctx) => ({ approved: true }),
    userRulesStorage: new FileUserPermissionRulesStorage(),
  },
});
policyAgent.policyManager.userRules.addRule(rule);  // PermissionPolicyManager
```

#### Programmatic Translation

```typescript
import { PermissionPolicyManager } from '@everworker/oneringai';

// From legacy config
const manager = PermissionPolicyManager.fromLegacyConfig({
  allowlist: ['my_tool'],
  blocklist: ['bad_tool'],
  defaultScope: 'session',
});

// From new config with policies
const manager = PermissionPolicyManager.fromConfig({
  allowlist: ['my_tool'],
  policies: [noSudoPolicy],
  userRulesStorage: new FileUserPermissionRulesStorage(),
  // NOTE: policyChain and auditStorage are not read by fromConfig() — see notes above.
});
```

Note: the chain default verdict is `'deny'` only when `onApprovalRequired` is supplied; otherwise it is `'allow'` to preserve backward compatibility (pre-policy-system behavior where all tools auto-execute). This is independent of whether `policies` are configured — `PermissionPolicyManager.fromConfig()` never reads `AgentPolicyConfig.policyChain`, so it cannot be used to force a strict `'deny'` default.

#### Accessing the Manager

```typescript
// New API (preferred)
const policyManager = agent.policyManager;

// Deprecated (still works for backward compatibility)
const legacyManager = agent.permissions;
```

### Pipeline Enforcement

The permission system is enforced via `PermissionEnforcementPlugin`, registered at priority 1 on the ToolManager's execution pipeline. This guarantees all tool calls are checked regardless of entry point:

```
ToolManager.execute()
    ↓
ToolExecutionPipeline.beforeExecute()
    ↓
PermissionEnforcementPlugin (priority: 1, runs FIRST)
    ↓
PolicyContext built from: tool args + ToolContext + registration metadata
    ↓
PermissionPolicyManager.check()
    ↓
If denied → throws ToolPermissionDeniedError
If allowed → execution continues to next plugin / tool handler
```

The `PermissionEnforcementPlugin` is automatically wired by `BaseAgent` during construction:

```typescript
// This happens automatically in BaseAgent constructor:
this._agentContext.tools.setPermissionManager(this._policyManager);
```

The plugin builds `PolicyContext` automatically from:
- Tool call arguments (from the execution pipeline context)
- `ToolContext` (userId, agentId, sessionId, roles)
- Tool registration metadata (source, category, namespace, tags, permission config)

### Complete Example

A complete example combining a public custom policy, user rules, an approval
callback, persistent rule storage, and audit events:

```typescript
import {
  Agent, Connector, Vendor,
  FileUserPermissionRulesStorage,
} from '@everworker/oneringai';
import type {
  ApprovalRequestContext,
  ApprovalDecision,
  IPermissionPolicy,
  PermissionAuditEntry,
} from '@everworker/oneringai';

declare function promptUser(question: string): Promise<'y' | 'n' | 'always'>;

// The package root exposes the policy interface, so applications can encode
// restrictions without importing source-internal policy implementations.
const workspaceSafetyPolicy: IPermissionPolicy = {
  name: 'app:workspace-safety',
  priority: 50,
  evaluate(ctx) {
    if (ctx.toolName === 'bash') {
      const command = String(ctx.args.command ?? '');
      if (/\b(?:sudo|rm\s+-rf)\b/.test(command)) {
        return {
          verdict: 'deny',
          reason: 'Privileged and recursive-delete commands are blocked',
          policyName: 'app:workspace-safety',
        };
      }
    }

    if (['read_file', 'write_file', 'edit_file'].includes(ctx.toolName)) {
      const path = String(ctx.args.path ?? '');
      if (!path.startsWith('/workspace/')) {
        return {
          verdict: 'deny',
          reason: 'File access is restricted to /workspace',
          policyName: 'app:workspace-safety',
        };
      }
    }

    return {
      verdict: 'abstain',
      reason: 'No workspace restriction matched',
      policyName: 'app:workspace-safety',
    };
  },
};

// Setup connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create agent with full permission configuration
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'alice',
  userRoles: ['developer'],

  permissions: {
    // Lists
    allowlist: ['my_custom_tool'],
    blocklist: ['legacy_dangerous_tool'],

    policies: [workspaceSafetyPolicy],

    // Per-user rules storage (persistent)
    userRulesStorage: new FileUserPermissionRulesStorage(),

    // Approval dialog
    onApprovalRequired: async (ctx: ApprovalRequestContext): Promise<ApprovalDecision> => {
      console.log(`[APPROVAL NEEDED] ${ctx.toolName}`);
      console.log(`  Risk: ${ctx.riskLevel}`);
      console.log(`  Reason: ${ctx.decision.reason}`);
      console.log(`  Args: ${JSON.stringify(ctx.args)}`);

      // Auto-approve low-risk tools for the session
      if (ctx.riskLevel === 'low') {
        return { approved: true, scope: 'session' };
      }

      // Always deny critical tools without asking
      if (ctx.riskLevel === 'critical') {
        return { approved: false, reason: 'Critical tools require admin approval' };
      }

      // Prompt the user for medium/high risk tools
      const answer = await promptUser(`Allow ${ctx.toolName}? (y/n/always)`);
      if (answer === 'always') {
        return {
          approved: true,
          createRule: {
            description: `User approved ${ctx.toolName}`,
            conditions: ctx.approvalKey !== ctx.toolName
              ? [{ argName: 'path', operator: 'starts_with', value: ctx.args.path as string }]
              : undefined,
          },
        };
      }
      return { approved: answer === 'y' };
    },
  },
});

// Listen to audit events
agent.policyManager.on('permission:audit', (entry: PermissionAuditEntry) => {
  console.log(`[AUDIT] ${entry.decision} ${entry.toolName}: ${entry.reason}`);
});

// Add a user rule programmatically
await agent.policyManager.userRules.addRule({
  id: crypto.randomUUID(),
  toolName: 'write_file',
  action: 'allow',
  conditions: [
    { argName: 'path', operator: 'starts_with', value: '/workspace/src/' },
  ],
  enabled: true,
  description: 'Allow writing to src directory',
  createdBy: 'admin',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}, 'alice');

// Run the agent — all tool calls are permission-checked automatically
const result = await agent.run('Read the README and refactor the auth module');
```

---

## MCP (Model Context Protocol)

The Model Context Protocol (MCP) is an open standard that enables seamless integration between AI applications and external data sources and tools. The library provides a complete MCP client implementation with support for both local (stdio) and remote (HTTP/HTTPS) servers.

### Overview

MCP allows you to:
- **Discover tools automatically** from MCP servers
- **Connect to local servers** via stdio (process spawning)
- **Connect to remote servers** via HTTP/HTTPS (StreamableHTTP)
- **Manage multiple servers** simultaneously
- **Auto-reconnect** with exponential backoff
- **Namespace tools** to prevent conflicts
- **Serializable client metadata** for diagnostics and host-managed restart flows

### Quick Start

#### 1. Install MCP SDK

```bash
npm install @modelcontextprotocol/sdk zod
```

#### 2. Connect to a Local MCP Server

```typescript
import { MCPRegistry, Agent, Connector, Vendor } from '@everworker/oneringai';

// Setup connector for LLM
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create MCP client for filesystem server
const client = MCPRegistry.create({
  name: 'filesystem',
  transport: 'stdio',
  transportConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  },
});

// Connect to the server
await client.connect();
console.log(`Connected! Available tools: ${client.tools.length}`);

// Create agent and register MCP tools
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });
client.registerTools(agent.tools);

// Agent can now use MCP tools
const response = await agent.run('List all TypeScript files in the current directory');
console.log(response.output_text);
```

#### 3. Connect to a Remote MCP Server

```typescript
// Create HTTP/HTTPS MCP client
const remoteClient = MCPRegistry.create({
  name: 'remote-api',
  transport: 'https',
  transportConfig: {
    url: 'https://mcp.example.com/api',
    token: process.env.MCP_TOKEN,
    headers: {
      'X-Client-Version': '1.0.0',
    },
    reconnection: {
      maxRetries: 5,
      initialReconnectionDelay: 1000,
      maxReconnectionDelay: 30000,
    },
  },
});

await remoteClient.connect();
remoteClient.registerTools(agent.tools);
```

### Configuration File

Create `oneringai.config.json` to declare MCP servers:

```json
{
  "version": "1.0",
  "mcp": {
    "servers": [
      {
        "name": "filesystem",
        "displayName": "Filesystem Server",
        "transport": "stdio",
        "transportConfig": {
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
        },
        "autoConnect": true,
        "toolNamespace": "mcp:fs",
        "permissions": {
          "defaultScope": "session",
          "defaultRiskLevel": "medium"
        }
      },
      {
        "name": "github",
        "displayName": "GitHub API",
        "transport": "https",
        "transportConfig": {
          "url": "https://mcp.example.com/github",
          "token": "${GITHUB_TOKEN}"
        },
        "autoConnect": false,
        "toolNamespace": "mcp:github"
      }
    ]
  }
}
```

Load and use the configuration:

```typescript
import { MCPRegistry, Agent } from '@everworker/oneringai';

// Reads JSON, interpolates ${ENV_VAR} values, and creates all declared clients.
const clients = await MCPRegistry.loadFromConfigFile('./oneringai.config.json');

// Connect every currently disconnected client in the registry.
await MCPRegistry.connectAll();

// Create agent and register tools
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });
for (const client of clients) {
  if (client.isConnected()) {
    client.registerTools(agent.tools);
  }
}
```

`loadFromConfigFile()` creates clients but does not connect them. In 1.0,
`MCPRegistry.connectAll()` connects **all** disconnected clients; it does not
filter on the declared `autoConnect` flag. Connect selected clients individually
if your application needs that distinction. Also use
`transportConfig.timeoutMs` for the HTTP abort timeout—the top-level
`requestTimeoutMs` field is currently not applied by `MCPClient`.

### MCPRegistry API

The static registry manages all MCP client connections:

```typescript
// Create a client
const client = MCPRegistry.create({
  name: 'my-server',
  transport: 'stdio',
  transportConfig: { /* ... */ },
});

// Get a client
const client = MCPRegistry.get('my-server');

// Check if exists
if (MCPRegistry.has('my-server')) {
  // ...
}

// List all servers
const serverNames = MCPRegistry.list();

// Get server info
const info = MCPRegistry.getInfo('my-server');
// { name, state, connected, toolCount }

// Get all server info
const allInfo = MCPRegistry.getAllInfo();

// Lifecycle management
await MCPRegistry.connectAll();
await MCPRegistry.disconnectAll();
MCPRegistry.destroyAll();
```

### MCPClient API

Each client manages a connection to one MCP server:

#### Connection Management

```typescript
// Connect to server
await client.connect();

// Disconnect
await client.disconnect();

// Reconnect
await client.reconnect();

// Check connection status
const isConnected = client.isConnected();

// Ping server (health check)
const alive = await client.ping();
```

#### Tool Operations

```typescript
// List available tools
const tools = await client.listTools();
console.log(tools.map(t => `${t.name}: ${t.description}`));

// Call a tool directly
const result = await client.callTool('read_file', {
  path: './README.md'
});
console.log(result.content);

// Register tools with agent
client.registerTools(agent.tools);

// Unregister tools
client.unregisterTools(agent.tools);
```

#### Resource Operations

```typescript
// List available resources
const resources = await client.listResources();

// Read a resource
const content = await client.readResource('file:///path/to/file');
console.log(content.text);

```

**1.0 limitation:** the client currently initializes negotiated capabilities as
an empty object and does not register an SDK notification handler for resource
updates. As a result, `subscribeResource()` cannot pass its capability check and
no `resource:updated` event is emitted. Treat resource subscriptions as
unavailable until that wiring is implemented; `listResources()` and
`readResource()` remain usable.

#### Prompt Operations

```typescript
// List available prompts
const prompts = await client.listPrompts();

// Get a prompt
const promptResult = await client.getPrompt('summarize', {
  length: 'short',
});

// Use prompt messages
for (const msg of promptResult.messages) {
  console.log(`${msg.role}: ${msg.content.text}`);
}
```

### Event Monitoring

Listen to connection and execution events:

```typescript
// Connection events
client.on('connected', () => {
  console.log('Connected to MCP server');
});

client.on('disconnected', () => {
  console.log('Disconnected from MCP server');
});

client.on('reconnecting', (attempt) => {
  console.log(`Reconnecting... attempt ${attempt}`);
});

client.on('failed', (error) => {
  console.error('Connection failed:', error);
});

// Tool execution events
client.on('tool:called', (name, args) => {
  console.log(`Tool called: ${name}`, args);
});

client.on('tool:result', (name, result) => {
  console.log(`Tool result: ${name}`, result);
});

// Error events
client.on('error', (error) => {
  console.error('MCP error:', error);
});
```

### Transport Types

#### Stdio Transport

For local MCP servers (spawns a process):

```typescript
const client = MCPRegistry.create({
  name: 'local-server',
  transport: 'stdio',
  transportConfig: {
    command: 'npx',                                    // or 'node', 'python', etc.
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path'],
    env: {
      NODE_ENV: 'production',
      CUSTOM_VAR: 'value',
    },
    cwd: '/working/directory',                        // Optional working directory
  },
});
```

**Best for:**
- Local file system access
- Database connections (PostgreSQL, SQLite)
- Development and testing

#### HTTP/HTTPS Transport

For remote MCP servers (StreamableHTTP with SSE):

```typescript
const client = MCPRegistry.create({
  name: 'remote-server',
  transport: 'https',
  transportConfig: {
    url: 'https://mcp.example.com/api',
    token: process.env.MCP_TOKEN,                      // Bearer token
    headers: {
      'X-Client-Version': '1.0.0',
      'X-Custom-Header': 'value',
    },
    timeoutMs: 30000,                                  // Request timeout (no default — omitting this applies no timeout at all)
    sessionId: 'optional-session-id',                  // For reconnection
    reconnection: {
      maxReconnectionDelay: 30000,                     // Max delay between retries (default: 30000)
      initialReconnectionDelay: 1000,                  // Initial delay (default: 1000)
      reconnectionDelayGrowFactor: 1.5,                // Backoff factor (default: 1.5)
      maxRetries: 5,                                   // Max attempts (default: 2)
    },
  },
});
```

**Best for:**
- Cloud-hosted services
- Production deployments
- Team collaboration
- Remote API access

### Tool Namespacing

MCP tools are automatically namespaced to prevent conflicts:

```typescript
// Default namespace: mcp:{server-name}:{tool-name} (sanitized to mcp_{server-name}_{tool-name}
// for tool-name compatibility — colons are not allowed in tool names)
// Example: mcp_filesystem_read_file, mcp_github_create_issue

// Custom namespace
const client = MCPRegistry.create({
  name: 'fs',
  toolNamespace: 'files',
  // ...
});
// Tools: files_read_file, files_write_file, etc.

// Check registered tools
const toolNames = agent.listTools();
console.log(toolNames.filter(name => name.startsWith('mcp_')));
```

### Multi-Server Example

Connect to multiple MCP servers simultaneously:

```typescript
import { MCPRegistry, Agent, Connector, Vendor } from '@everworker/oneringai';

// Setup connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create multiple clients
const fsClient = MCPRegistry.create({
  name: 'filesystem',
  transport: 'stdio',
  transportConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  },
});

const githubClient = MCPRegistry.create({
  name: 'github',
  transport: 'https',
  transportConfig: {
    url: 'https://mcp.example.com/github',
    token: process.env.GITHUB_TOKEN,
  },
});

const dbClient = MCPRegistry.create({
  name: 'postgres',
  transport: 'stdio',
  transportConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: {
      DATABASE_URL: process.env.DATABASE_URL!,
    },
  },
});

// Connect all
await Promise.all([
  fsClient.connect(),
  githubClient.connect(),
  dbClient.connect(),
]);

// Create agent and register all tools
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });
fsClient.registerTools(agent.tools);
githubClient.registerTools(agent.tools);
dbClient.registerTools(agent.tools);

console.log(`Total tools: ${agent.listTools().length}`);

// Agent can now use tools from all servers
await agent.run('Query the database, analyze files, and create a GitHub issue with the results');
```

### Finding MCP Servers

The MCP steering group's [reference-server repository](https://github.com/modelcontextprotocol/servers)
currently maintains a small educational set: Everything, Fetch, Filesystem,
Git, Memory, Sequential Thinking, and Time. These demonstrate protocol and SDK
features and are not presented as production-ready services. Browse published
packages in the [official MCP Registry](https://registry.modelcontextprotocol.io/)
and evaluate each server's permissions, maintenance, and threat model. Older
GitHub, Google Drive, Slack, PostgreSQL, SQLite, and Brave Search reference
servers should not be described as current official packages.

### Error Handling

```typescript
import {
  MCPError,
  MCPConnectionError,
  MCPToolError,
} from '@everworker/oneringai';

try {
  await client.connect();
} catch (error) {
  if (error instanceof MCPConnectionError) {
    console.error('Failed to connect:', error.message);
    // Retry or use fallback
  } else if (error instanceof MCPToolError) {
    console.error('Tool execution failed:', error.toolName);
  } else if (error instanceof MCPError) {
    console.error('Protocol error:', error.message);
  }
}
```

### State Persistence

Save and restore MCP client state:

```typescript
// Get current state
const state = client.getState();
console.log(state);
// {
//   name: 'filesystem',
//   state: 'connected',
//   capabilities: {},
//   subscribedResources: [],
//   lastConnectedAt: 1234567890,
//   connectionAttempts: 0
// }

// Save to storage
await storage.save('mcp-state', state);

// Load diagnostic/subscription metadata
const savedState = await storage.load('mcp-state');
const newClient = MCPRegistry.create(config);
newClient.loadState(savedState);
await newClient.connect();
```

`loadState()` restores only the local subscription URI set and reconnect-attempt
counter. It does not restore a live transport, capabilities, tools, or server
session, and `connect()` does not replay `resources/subscribe` requests. If a
future client version exposes working subscriptions, the host must still
re-subscribe explicitly after connecting.

### Best Practices

1. **Use Configuration Files** - Declare servers in `oneringai.config.json` for easier management; remember that `autoConnect` is not currently enforced by `connectAll()`
2. **Handle Reconnection** - Enable `autoReconnect` for production deployments
3. **Monitor Events** - Listen to connection events for observability
4. **Use Namespaces** - Set custom `toolNamespace` to organize tools clearly
5. **Error Handling** - Always wrap MCP operations in try/catch
6. **Clean Up** - Call `client.disconnect()` when done
7. **Health Checks** - Use `client.ping()` for monitoring
8. **Permission Control** - Set appropriate `defaultScope` for security
9. **Set HTTP Timeouts at the transport** - Use `transportConfig.timeoutMs`; `requestTimeoutMs` is not currently wired into requests

### Troubleshooting

#### Connection Issues

```typescript
// Enable detailed error logging
client.on('error', (error) => {
  console.error('MCP Error:', error);
  console.error('Stack:', error.stack);
});

// Check connection state
console.log('State:', client.state);
console.log('Connected:', client.isConnected());

// Manual reconnect
if (!client.isConnected()) {
  await client.reconnect();
}
```

#### Tool Discovery

```typescript
// List all discovered tools
const tools = await client.listTools();
console.log('Available tools:');
tools.forEach(tool => {
  console.log(`  ${tool.name}: ${tool.description}`);
  console.log('  Input schema:', JSON.stringify(tool.inputSchema, null, 2));
});

// Check server capabilities
console.log('Capabilities:', client.capabilities);
```

#### Debug Mode

```typescript
// Log all tool calls
client.on('tool:called', (name, args) => {
  console.log(`[DEBUG] Tool called: ${name}`);
  console.log('[DEBUG] Args:', JSON.stringify(args, null, 2));
});

client.on('tool:result', (name, result) => {
  console.log(`[DEBUG] Tool result: ${name}`);
  console.log('[DEBUG] Result:', JSON.stringify(result, null, 2));
});
```

### Transport Extension Boundary

The public `MCPServerConfig` currently accepts only `stdio`, `http`, and
`https`; `MCPClient` constructs the corresponding SDK transport internally.
Implementing the SDK's `Transport` interface alone is therefore not enough to
inject a custom transport into OneRingAI 1.0. Add an adapter in the library or
use the MCP SDK client directly when another transport is required.

---

## Multimodal (Vision)

### Analyzing Images

```typescript
import { Agent, createMessageWithImages } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-5.6-terra',
});

// From file path
const response1 = await agent.run([
  createMessageWithImages('What is in this image?', ['./photo.jpg'])
]);

// From URL
const response2 = await agent.run([
  createMessageWithImages('Describe this image', [
    'https://example.com/image.jpg'
  ])
]);

// From base64
const base64Image = Buffer.from(imageData).toString('base64');
const response3 = await agent.run([
  createMessageWithImages('Analyze this', [
    `data:image/jpeg;base64,${base64Image}`
  ])
]);

// Multiple images
const response4 = await agent.run([
  createMessageWithImages(
    'Compare these two images',
    ['./image1.jpg', './image2.jpg']
  )
]);
```

### Clipboard Images

Paste images directly from clipboard (like Claude Code!):

```typescript
import { Agent, readClipboardImage, hasClipboardImage } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-opus-5',
});

// Check if clipboard has an image
if (await hasClipboardImage()) {
  // Read clipboard image
  const result = await readClipboardImage();

  if (result.success && result.dataUri) {
    const response = await agent.run([
      createMessageWithImages('What is in this screenshot?', [
        result.dataUri
      ])
    ]);

    console.log(response.output_text);
  }
}
```

### Vision with Tools

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-5.6-terra',
  tools: [extractTextTool, identifyObjectsTool],
});

const response = await agent.run([
  createMessageWithImages(
    'Extract all text from this receipt and calculate the total',
    ['./receipt.jpg']
  )
]);

// Agent will:
// 1. Analyze image
// 2. Call extractTextTool to extract text
// 3. Parse numbers
// 4. Calculate total
```

---

## Audio (TTS/STT)

The library provides comprehensive Text-to-Speech (TTS) and Speech-to-Text (STT) capabilities.
These APIs are request-based and work best for files or bounded generation. For
live speech-to-speech, streaming transcription, or continuous translation, use
the [OpenAI Realtime API](#openai-realtime-api) or
[xAI Voice Agent API](#xai-realtime-voice-agent-api).

### Text-to-Speech

#### Basic Usage

```typescript
import { Connector, TextToSpeech, Vendor } from '@everworker/oneringai';

// Setup connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create TTS instance
const tts = TextToSpeech.create({
  connector: 'openai',
  model: 'tts-1-hd',      // High-quality model
  voice: 'nova',          // Female voice
});

// Synthesize to Buffer
const response = await tts.synthesize('Hello, world!');
console.log(response.audio);   // Buffer
console.log(response.format);  // 'mp3'

// Synthesize to file
await tts.toFile('Hello, world!', './output.mp3');
```

#### Voice Options

```typescript
// Available voices
const voices = await tts.listVoices();
// [
//   { id: 'alloy', name: 'Alloy', gender: 'neutral', isDefault: true },
//   { id: 'echo', name: 'Echo', gender: 'male' },
//   { id: 'fable', name: 'Fable', gender: 'neutral', accent: 'british' },
//   { id: 'onyx', name: 'Onyx', gender: 'male' },
//   { id: 'nova', name: 'Nova', gender: 'female' },
//   { id: 'shimmer', name: 'Shimmer', gender: 'female' },
//   ...
// ]

// Synthesize with specific voice
const audio = await tts.synthesize('Hello', { voice: 'echo' });
```

#### Custom Voices (OpenAI)

OpenAI lets you register a custom voice in the dashboard and reference it
through the API. The library accepts the resulting `voice_…` id wherever a
built-in voice name is expected — the SDK call shape (`voice: { id }`) is
handled internally.

```typescript
const branded = TextToSpeech.create({
  connector: 'openai',
  model: 'gpt-4o-mini-tts',
  voice: 'voice_1234abcd', // id returned by OpenAI when the custom voice was created
});

await branded.toFile('Spoken in your bespoke voice.', './brand.mp3');

// Override per-call as well
await branded.synthesize('Different copy.', { voice: 'voice_5678efgh' });
```

**How it's detected:** any string starting with `voice_` is forwarded as a
custom-voice reference; everything else is treated as a built-in voice name
(`alloy`, `ash`, `ballad`, `coral`, `echo`, `fable`, `onyx`, `nova`, `sage`,
`shimmer`, `verse`, `marin`, `cedar`). `tts.listVoices()` returns only the
built-ins — the dashboard is the source of truth for custom-voice ids.

#### Audio Formats

```typescript
// Supported formats: mp3, opus, aac, flac, wav, pcm
const mp3 = await tts.synthesize('Hello', { format: 'mp3' });
const wav = await tts.synthesize('Hello', { format: 'wav' });
const flac = await tts.synthesize('Hello', { format: 'flac' });
```

#### Speed Control

```typescript
// Speed range: 0.25 (slow) to 4.0 (fast)
const slow = await tts.synthesize('Speaking slowly', { speed: 0.5 });
const normal = await tts.synthesize('Normal speed', { speed: 1.0 });
const fast = await tts.synthesize('Speaking fast', { speed: 2.0 });
```

#### Instruction Steering (gpt-4o-mini-tts)

The `gpt-4o-mini-tts` model supports instruction steering for emotional control:

```typescript
const tts = TextToSpeech.create({
  connector: 'openai',
  model: 'gpt-4o-mini-tts',
  voice: 'nova',
});

const audio = await tts.synthesize('I\'m so happy to see you!', {
  vendorOptions: {
    instructions: 'Speak with enthusiasm and joy, like greeting an old friend.',
  },
});
```

#### Model Introspection

```typescript
// Get model information
const info = tts.getModelInfo();
console.log(info.capabilities.features.instructionSteering); // true for gpt-4o-mini-tts

// Check feature support
const canSteer = tts.supportsFeature('instructionSteering');
const canStream = tts.supportsFeature('streaming');

// Get supported formats
const formats = tts.getSupportedFormats();  // ['mp3', 'opus', 'aac', ...]

// List available models
const models = tts.listAvailableModels();
```

#### Streaming TTS

For real-time voice applications, TTS audio can be streamed as chunks arrive from the API instead of waiting for the entire response to buffer. This is useful for voice assistants and interactive agents.

```typescript
import { TextToSpeech } from '@everworker/oneringai';

const tts = TextToSpeech.create({
  connector: 'openai',
  model: 'tts-1-hd',
  voice: 'nova',
});

// Check if provider supports streaming
console.log(tts.supportsStreaming('pcm'));  // true for OpenAI

// Stream PCM audio chunks
for await (const chunk of tts.synthesizeStream('Hello, world!', { format: 'pcm' })) {
  if (chunk.audio.length > 0) {
    // Process raw PCM data (24kHz, 16-bit signed LE, mono)
    playPCMChunk(chunk.audio);
  }
  if (chunk.isFinal) break;
}

// Non-streaming providers gracefully fall back to buffered synthesis
// (yields a single chunk with isFinal: true)
```

**VoiceStream** wraps an agent's text stream and interleaves audio events:

```typescript
import { VoiceStream } from '@everworker/oneringai';

const voice = VoiceStream.create({
  ttsConnector: 'openai',
  ttsModel: 'tts-1-hd',
  voice: 'nova',
  format: 'mp3',       // MP3 recommended for broad compatibility
  streaming: false,     // Set true + format 'pcm' for low-latency streaming
});

// Wraps agent stream — text events pass through, audio events interleaved
for await (const event of voice.wrap(agent.stream('Tell me a story'))) {
  if (event.type === 'response.output_text.delta') {
    process.stdout.write(event.delta);
  } else if (event.type === 'response.audio_chunk.ready') {
    playAudio(event.audio_base64, event.format);
  }
}
```

**Streaming notes:**
- **MP3 format** (default) is recommended — best compatibility and quality
- **PCM format** enables streaming mode but browser playback is experimental
- Streaming providers (OpenAI and xAI) yield chunks as they arrive from the API
- Non-streaming providers fall back to buffered synthesis automatically
- VoiceStream accumulates small API chunks into ~125ms buffers before emitting events

#### xAI TTS and WebSocket streaming

Use a Grok connector with the endpoint model id `xai-tts`. xAI accepts expressive
tags such as `[laugh]` and `[pause]`, custom voice ids, BCP-47 language codes,
telephony codecs, and bidirectional WebSocket streaming.
For buffered synthesis, `vendorOptions.output_format.codec` may override the
normalized `format`; `TTSResponse.format` follows xAI's response `Content-Type`
or JSON `content_type`, so returned WAV/PCM/telephony bytes are never mislabeled
with the caller's earlier default.

```typescript
Connector.create({
  name: 'xai',
  vendor: Vendor.Grok,
  auth: { type: 'api_key', apiKey: process.env.XAI_API_KEY! },
});

const xaiTTS = TextToSpeech.create({
  connector: 'xai', model: 'xai-tts', voice: 'eve',
});

for await (const chunk of xaiTTS.synthesizeStream('[laugh] Hello!', {
  format: 'mulaw',
  vendorOptions: {
    language: 'en',
    sample_rate: 8000,
    optimize_streaming_latency: 2, // xAI accepts levels 0, 1, and 2
  },
})) {
  if (chunk.audio.length) sendToPhone(chunk.audio);
}
```

### Speech-to-Text

#### Basic Usage

```typescript
import { Connector, SpeechToText, Vendor } from '@everworker/oneringai';

// Setup connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create STT instance
const stt = SpeechToText.create({
  connector: 'openai',
  model: 'gpt-transcribe',
});

// Transcribe from file path
const result = await stt.transcribeFile('./audio.mp3');
console.log(result.text);

// Transcribe from Buffer
import * as fs from 'fs/promises';
const audioBuffer = await fs.readFile('./audio.mp3');
const result2 = await stt.transcribe(audioBuffer);
```

When a `Buffer` contains a normal audio container, OneRingAI detects WAV, AIFF,
MP3, FLAC, Ogg, WebM, MP4/M4A, or AAC bytes and preserves that format. For a
headerless raw buffer, provide the normalized wire metadata. AAC ADTS headers,
including the `F0`/`F8` CRC-protected variants and `F1`/`F9` unprotected
variants, are checked before MPEG frame sync so AAC is never mislabeled as MP3:

```typescript
const telephoneAudio = await stt.transcribe(pcm16le8kBuffer, {
  encoding: 'pcm',       // 'pcm', 'mulaw', or 'alaw'
  sampleRate: 8000,
});
```

Raw input otherwise defaults to signed 16-bit little-endian PCM at 16 kHz.
This is especially important for Twilio audio, which is 8 kHz; `TextPipeline`
sets that metadata automatically after the adapter decodes PCMU to PCM. When
OpenAI receives raw μ-law or A-law, OneRingAI wraps it in a non-PCM WAV with an
18-byte `WAVEFORMATEX` chunk and the required zero `cbSize`; PCM keeps the
standard 16-byte `fmt` chunk.

#### Timestamps

```typescript
// Whisper remains available when word/segment timestamp formats are required.
const timestampedStt = SpeechToText.create({
  connector: 'openai',
  model: 'whisper-1',
});

// Word-level timestamps
const withWords = await timestampedStt.transcribeWithTimestamps(audioBuffer, 'word');
console.log(withWords.words);
// [
//   { word: 'Hello', start: 0.0, end: 0.5 },
//   { word: 'world', start: 0.6, end: 1.1 },
// ]

// Segment-level timestamps
const withSegments = await timestampedStt.transcribeWithTimestamps(audioBuffer, 'segment');
console.log(withSegments.segments);
// [
//   { id: 0, text: 'Hello world.', start: 0.0, end: 1.5 },
// ]
```

Google's dedicated `gemini-3.5-transcribe` model uses the Interactions API and
supports automatic language detection, word/segment timestamps, custom
vocabulary, and speaker diarization. `gemini-3.5-transcribe-live` is the
bidirectional WebSocket model; the high-level file provider uses the non-live
model. Google output is plain text, so `json`, `verbose_json`, `srt`, and `vtt`
are rejected instead of being silently ignored:

```typescript
const googleResult = await googleStt.transcribe(audio, {
  language: 'en',
  includeTimestamps: true,
  timestampGranularity: 'segment',
  vendorOptions: {
    customVocabulary: ['OneRingAI'],
    diarizationMode: 'speaker',
  },
});
```

#### Translation

Translate audio to English:

```typescript
const stt = SpeechToText.create({
  connector: 'openai',
  model: 'whisper-1',
  language: 'fr', // default source-language hint for transcribe and translate
});

// Translate French audio to English
const english = await stt.translate(frenchAudioBuffer);
const germanHint = await stt.translate(germanAudioBuffer, { language: 'de' });
console.log(english.text);  // English translation
```

`translate()` forwards the instance default unless a per-call `language` is
provided. The language is a source-language hint; the selected model/provider
still determines the translation target.

#### Output Formats

```typescript
// JSON (default)
const json = await stt.transcribe(audio, { outputFormat: 'json' });

// Plain text
const text = await stt.transcribe(audio, { outputFormat: 'text' });

// Subtitles (SRT format)
const srt = await stt.transcribe(audio, { outputFormat: 'srt' });

// WebVTT format
const vtt = await stt.transcribe(audio, { outputFormat: 'vtt' });

// Verbose JSON (includes all metadata)
const verbose = await stt.transcribe(audio, { outputFormat: 'verbose_json' });
```

#### Language Hints

```typescript
// Provide language hint for better accuracy
const result = await stt.transcribe(audio, { language: 'fr' });  // French
const result2 = await stt.transcribe(audio, { language: 'es' }); // Spanish
```

#### xAI live streaming transcription

`SpeechToText.transcribeStream()` is available when the selected provider
implements `IStreamingSpeechToTextProvider`. It accepts real-time-paced raw
audio chunks and yields `created`, `transcript`, and `done` events. xAI supports
PCM16, G.711 µ-law/A-law, interim results, keyterms, diarization, multichannel
audio, VAD endpointing, and Smart Turn.

```typescript
const liveSTT = SpeechToText.create({ connector: 'xai', model: 'xai-stt' });

for await (const event of liveSTT.transcribeStream(microphoneChunks(), {
  sampleRate: 16000,
  encoding: 'pcm',
  interimResults: true,
  language: 'en',
  vendorOptions: {
    keyterms: ['OneRingAI'],
    smart_turn: 0.7,
    smart_turn_timeout: 3000,
  },
})) {
  if (event.type === 'transcript') {
    renderTranscript(event.text ?? '', { final: event.isFinal });
  }
}
```

The library waits for `transcript.created` before sending binary frames and
sends `audio.done` after the input iterator completes. The iterator must pace
audio in real time; buffered audio is not automatically delayed. Yield
`{ type: 'finalize' }` (or include `channel`) for push-to-talk utterance
finalization without closing the session.

#### Model Introspection

```typescript
// Get model information
const info = stt.getModelInfo();
console.log(info.capabilities.features.diarization);  // Speaker identification

// Check feature support
const supportsTranslation = stt.supportsFeature('translation');
const supportsDiarization = stt.supportsFeature('diarization');

// Get supported formats
const inputFormats = stt.getSupportedInputFormats();
const outputFormats = stt.getSupportedOutputFormats();

// Get timestamp granularities
const granularities = stt.getTimestampGranularities();  // model-specific
```

### Available Models

#### TTS Models

| Model | Provider | Features | Price/1k chars |
|-------|----------|----------|----------------|
| `gpt-4o-mini-tts` | OpenAI | Instruction steering, emotions | $0.015 |
| `tts-1` | OpenAI | Fast, low-latency | $0.015 |
| `tts-1-hd` | OpenAI | High-quality audio | $0.030 |
| `gemini-3.1-flash-tts-preview` | Google | Current controllable low-latency TTS | token priced |
| `gemini-2.5-flash-preview-tts` | Google | Low latency, 30 voices | - |
| `gemini-2.5-pro-preview-tts` | Google | High quality, 30 voices | - |
| `xai-tts` | xAI | REST/WebSocket, expressive tags, custom voices, telephony codecs | $0.015 |

#### STT Models

| Model | Provider | Features | Price/minute |
|-------|----------|----------|--------------|
| `gpt-transcribe` | OpenAI | Current accurate file transcription | $0.0045 |
| `gpt-4o-mini-transcribe` | OpenAI | Economical file transcription | $0.003 |
| `gpt-live-transcribe` | OpenAI | Recommended realtime streaming transcription, latency control, vocabulary/language hints | $0.017 |
| `gpt-realtime-whisper` | OpenAI | Low-latency realtime streaming transcription | $0.017 |
| `gpt-4o-transcribe` | OpenAI | Superior accuracy | $0.006 |
| `gpt-4o-transcribe-diarize` | OpenAI | Speaker identification | $0.012 |
| `whisper-1` | OpenAI | Legacy-compatible general-purpose transcription | $0.006 |
| `whisper-large-v3` | Groq | High-accuracy multilingual Whisper, word/segment timestamps | $0.00185 |
| `whisper-large-v3-turbo` | Groq | Current cost-optimized multilingual Whisper | $0.00067 |
| `gemini-3.5-transcribe` | Google | File transcription, word timestamps, vocabulary, diarization | ~$0.005 |
| `gemini-3.5-transcribe-live` | Google | Bidirectional WebSocket transcription | ~$0.009 |
| `xai-stt` | xAI | REST + WebSocket, diarization, multichannel, Smart Turn | $0.00167 REST / $0.00333 stream |

### Voice Assistant Pipeline

Combine TTS and STT for a voice assistant:

```typescript
import { Connector, Agent, TextToSpeech, SpeechToText, Vendor } from '@everworker/oneringai';

// Setup
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

const stt = SpeechToText.create({ connector: 'openai', model: 'gpt-transcribe' });
const agent = Agent.create({ connector: 'openai', model: 'gpt-5.6-terra' });
const tts = TextToSpeech.create({ connector: 'openai', model: 'tts-1-hd', voice: 'nova' });

// Voice assistant pipeline
async function voiceAssistant(audioInput: Buffer): Promise<Buffer> {
  // 1. Speech → Text
  const transcription = await stt.transcribe(audioInput);
  console.log('User said:', transcription.text);

  // 2. Text → AI Response
  const response = await agent.run(transcription.text);
  console.log('Agent response:', response.output_text);

  // 3. Text → Speech
  const audioResponse = await tts.synthesize(response.output_text);
  return audioResponse.audio;
}
```

### Cost Estimation

```typescript
import { calculateTTSCost, calculateSTTCost } from '@everworker/oneringai';

// TTS cost (per 1,000 characters)
const ttsCost = calculateTTSCost('tts-1-hd', 5000);  // 5000 characters
console.log(`TTS cost: $${ttsCost}`);  // $0.15

// STT cost (per minute)
const sttCost = calculateSTTCost('gpt-transcribe', 300);  // 5 minutes
console.log(`STT cost: $${sttCost}`);  // $0.0225

// Groq is much cheaper for STT
const groqCost = calculateSTTCost('whisper-large-v3', 300);  // 5 minutes
console.log(`Groq STT cost: $${groqCost}`);  // $0.0025

const xaiStreaming = calculateSTTCost('xai-stt', 300, { streaming: true });
```

---

## OpenAI Realtime API

The OpenAI Realtime API is the low-latency path for live audio. Unlike the
request-based TTS/STT APIs above, a realtime session keeps a connection open,
accepts audio or text as it arrives, and streams events back immediately.
OneRingAI exposes the GA API through the same connector-first authentication
used everywhere else in the library.

Use the Realtime API for:

- speech-to-speech agents that reason, answer, and call tools;
- live captions or call transcription without an assistant response;
- continuous speech-to-speech translation;
- browser/mobile audio over WebRTC;
- server media pipelines over WebSocket; and
- telephony through OpenAI SIP controls or `VoiceBridge` with Twilio Media Streams.

### Choose a Session Type and Transport

| Goal | Model | Session/endpoint | Recommended transport |
|------|-------|------------------|-----------------------|
| Voice agent | `gpt-realtime-2.1` | Realtime conversation, `/v1/realtime` | WebRTC in browsers; WebSocket on servers |
| Lower-cost voice agent | `gpt-realtime-2.1-mini` | Realtime conversation, `/v1/realtime` | WebRTC or WebSocket |
| Live transcription | `gpt-live-transcribe` | `type: 'transcription'`, `/v1/realtime?intent=transcription` | WebRTC or WebSocket |
| Continuous translation | `gpt-realtime-translate` | `/v1/realtime/translations` | WebRTC in browsers; WebSocket on servers |
| Phone agent through Twilio | `gpt-realtime-2.1` | `VoiceBridge` realtime pipeline | Twilio Media Streams + server WebSocket |
| Phone agent through OpenAI SIP | Supported realtime voice model | `/v1/realtime/calls/*` control endpoints | SIP |

`OpenAIRealtimeAgentSession` is the preferred voice-agent surface. It binds a
normal `Agent` to a Realtime transport and preserves Agent context plugins,
memory refresh, identity-filtered tools, permission policies, tool hooks,
limits, metrics, parallel function results, and provider-hosted MCP approvals.
Its transport contract can be implemented by WebSocket, a WebRTC data channel,
or a SIP/server-control bridge.

`OpenAIRealtimeSession` is the lower-level server-side WebSocket client. It handles
connector authentication, session creation, JSON serialization, endpoint
selection, and the protocol differences between conversation, transcription,
and translation sessions. It intentionally leaves audio capture/playback to the
host and exposes every server event so applications are not limited by a closed
event union as OpenAI evolves the protocol.

`OpenAIRealtimeAPI` contains the REST operations: minting WebRTC credentials,
exchanging an SDP offer with `/v1/realtime/calls`, and controlling SIP calls. It
does not put a long-lived OpenAI API key in the browser.

### Authentication and Setup

Create a normal OpenAI connector. The connector may use the default OpenAI base
URL or an explicit compatible proxy URL.

```typescript
import {
  Connector,
  OpenAIRealtimeAPI,
  OpenAIRealtimeSession,
  Vendor,
} from '@everworker/oneringai';

const openai = Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: {
    type: 'api_key',
    apiKey: process.env.OPENAI_API_KEY!,
  },
});
```

Keep the standard API key on a trusted server. For an identifiable end user,
pass a stable, privacy-preserving `safetyIdentifier` (for example, a one-way hash
of an internal user id). The library sends it through the
`OpenAI-Safety-Identifier` header.

### Server WebSocket Voice Agent

For a tool-using agent, use the agent-aware session. `contextSync: 'per_turn'`
is the default: it disables automatic VAD response creation, waits for the input
transcript, refreshes Agent memory/plugin instructions and the dynamic tool set,
then requests the response. If transcription fails, it still continues with the
original audio so the turn cannot deadlock.

```typescript
import {
  Agent,
  OpenAIRealtimeAgentSession,
} from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-realtime-2.1',
  instructions: 'Be concise and confirm consequential actions.',
  userId: 'user-123',
  tools: [lookupOrder, createTicket],
  permissions: { onApprovalRequired: approveLocalTool },
  context: {
    model: 'gpt-realtime-2.1',
    features: { memory: true },
    plugins: { memory: { memory } },
  },
});

const voice = new OpenAIRealtimeAgentSession({
  agent,
  safetyIdentifier: hashUserId('user-123'),
  session: {
    reasoning: { effort: 'low' },
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        turn_detection: { type: 'semantic_vad', eagerness: 'auto' },
      },
      output: {
        format: { type: 'audio/pcm', rate: 24000 },
        voice: 'marin',
      },
    },
    tools: [{
      type: 'mcp',
      server_label: 'crm',
      connector_id: 'conn_crm',
      require_approval: 'always',
    }],
  },
  approveMCP: async (request) => authorizeHostedTool(request),
});

voice.on('audio', playPcm24);
voice.on('transcript:input', showUserTranscript);
voice.on('transcript:output', showAssistantTranscript);
voice.on('usage', recordCumulativeUsage);
voice.on('error', reportVoiceError);

await voice.connect();
voice.appendAudio(pcm24Chunk);

// Text and image turns use the same managed Agent context.
await voice.sendText('Summarize the current order status.');
await voice.sendImage('https://example.com/damaged-package.jpg');

await voice.close();
agent.destroy();
```

Missing `approveMCP` handlers reject MCP approval requests by default. Local
function calls always execute through `Agent.executeExternalToolCall()`, so
Agent hooks, connector identity, permission policy, circuit breakers, hard
timeouts, and metrics behave the same way as in `agent.run()`.

The agent-aware session decodes base64 `response.output_audio.delta` events and
emits their bytes through `audio`. A custom WebRTC/media transport that already
does this must set `emitsOutputAudioFromEvents: true` to avoid duplicate audio.
Normal `close()` completes the external Agent execution, closing after
`agent.cancel()` reports `cancelled`, and an unrequested transport close reports
`failed` regardless of its WebSocket close code.

Use the raw WebSocket session when the host intentionally owns context and tool
execution itself:

The default model is `gpt-realtime-2.1`. Audio sent to `appendAudio()` may be a
`Buffer` or an already-base64-encoded string. PCM audio is signed 16-bit little
endian, mono, at 24 kHz; PCMU and PCMA use their native 8 kHz telephony format.

```typescript
const realtime = new OpenAIRealtimeSession({
  connector: openai,
  model: 'gpt-realtime-2.1',
  safetyIdentifier: hashUserId('user-123'),
  session: {
    instructions: 'Be concise, friendly, and confirm important numbers.',
    reasoning: { effort: 'low' },
    output_modalities: ['audio'],
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        noise_reduction: { type: 'near_field' },
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'auto',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: {
        format: { type: 'audio/pcm', rate: 24000 },
        voice: 'marin',
      },
    },
  },
});

realtime.on('event', (event) => {
  switch (event.type) {
    case 'response.output_audio.delta':
      playPcm24(Buffer.from(event.delta, 'base64'));
      break;
    case 'response.output_audio_transcript.delta':
      process.stdout.write(event.delta);
      break;
    case 'error':
      console.error(event.error);
      break;
  }
});

realtime.on('error', console.error); // socket, parsing, and connection errors
realtime.on('close', (code, reason) => console.log('closed', code, reason));

await realtime.connect();

// Text turns are useful for testing or mixed text/audio applications.
realtime.sendText('Introduce yourself in one short sentence.');
realtime.createResponse();

// Stream microphone/server audio as it arrives.
realtime.appendAudio(pcm24Chunk);

// Only commit/request manually when automatic VAD is disabled.
realtime.commitAudio();
realtime.createResponse();
```

For a new Realtime WebSocket, `connect()` resolves after `session.created`. For
a `callId` sideband connection to an existing WebRTC or SIP call, OpenAI does
not replay that creation event; the library waits for the socket to open, sends
an initial `session.update`, and resolves after `session.updated` acknowledges
the control channel. Register event listeners before connecting so no early
events are missed.

### Session Helpers and Events

The wrapper keeps the protocol accessible instead of hiding it behind a narrow
abstraction:

| Method | Client event/behavior |
|--------|-----------------------|
| `updateSession(session)` | Sends `session.update` using the correct session shape |
| `appendAudio(bufferOrBase64)` | Sends the appropriate audio-buffer append event; returns `false` under configured WebSocket backpressure |
| `commitAudio()` | Commits a standard/transcription audio turn |
| `clearAudio()` | Clears uncommitted standard/transcription input audio |
| `sendText(text)` | Adds a user text conversation item |
| `sendImage(url)` | Adds an image input conversation item |
| `createResponse(config?)` | Requests a voice-agent response |
| `cancelResponse()` | Cancels the active response |
| `truncateItem(itemId, endMs, contentIndex?)` | Truncates assistant audio already in conversation state |
| `closeTranslation()` | Sends translation-only `session.close` so pending output can drain |
| `send(event)` | Sends any GA client event directly |
| `close(code?, reason?)` | Closes the WebSocket and removes listeners |

Every server message is emitted through the typed `event` subscription. At
runtime it is also emitted under its exact event-type string for consumers using
the underlying `EventEmitter` dynamically, except API `error` payloads: Node
reserves the `error` event for `Error` objects, so OpenAI error payloads remain
on the raw `event` stream. Prefer the typed `event` listener shown above.

`OpenAIRealtimeServerEvent` and `OpenAIRealtimeClientEvent` have a typed `type`
and `event_id`, plus an open index signature. Narrow on `event.type` before
reading event-specific fields.

### Audio, VAD, and Interruption Configuration

Supported audio formats are:

```typescript
type OpenAIRealtimeAudioFormat =
  | { type: 'audio/pcm'; rate: 24000 }
  | { type: 'audio/opus'; rate?: 24000 }
  | { type: 'audio/pcmu' }
  | { type: 'audio/pcma' };

type GrokRealtimeAudioFormat =
  | { type: 'audio/pcm'; rate: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000 }
  | { type: 'audio/opus'; rate?: 24000 }
  | { type: 'audio/pcmu' }
  | { type: 'audio/pcma' };
```

`OpenAIRealtimeAudioFormat` accepts only OpenAI's 24 kHz PCM contract, while
`GrokRealtimeAudioFormat` carries xAI's full PCM range. REST and WebSocket
OpenAI boundaries—including every `updateSession()` call—also validate the rate
at runtime to protect JavaScript and type-escape callers. The xAI-specific
session accepts its wider rate set in both initial configuration and updates.

Turn detection accepts `server_vad`, `semantic_vad`, or `null`:

```typescript
// Silence-based VAD
const serverVAD = {
  type: 'server_vad' as const,
  threshold: 0.5,
  prefix_padding_ms: 400,
  silence_duration_ms: 500,
  idle_timeout_ms: 15_000,
  create_response: true,
  interrupt_response: true,
};

// Model-based end-of-turn detection
const semanticVAD = {
  type: 'semantic_vad' as const,
  eagerness: 'auto' as const, // low | medium | high | auto
  create_response: true,
  interrupt_response: true,
};
```

Set `turn_detection: null` when your application owns the turn boundary. Append
audio, call `commitAudio()`, and then `createResponse()`. When users interrupt
playback, cancel the response, stop local playback, and use `truncateItem()` to
keep server conversation state aligned with what the user actually heard.
`VoiceBridge` performs this barge-in sequence automatically.

Input noise reduction supports `{ type: 'near_field' }`,
`{ type: 'far_field' }`, or `null`. Output speed is supported from 0.25 to 1.5.

### Advanced Session Configuration

The session type covers reasoning, tools, tracing, stored prompts, token limits,
parallel tool calls, and retention-ratio truncation:

```typescript
const advanced = new OpenAIRealtimeSession({
  connector: 'openai',
  model: 'gpt-realtime-2.1',
  session: {
    reasoning: { effort: 'low' },
    max_output_tokens: 2048,
    parallel_tool_calls: true,
    prompt: {
      id: 'pmpt_voice_support',
      version: '3',
      variables: { company: 'Acme' },
    },
    tracing: {
      workflow_name: 'phone-support',
      group_id: 'call-42',
      metadata: { region: 'eu' },
    },
    truncation: {
      type: 'retention_ratio',
      retention_ratio: 0.8,
      token_limits: { post_instructions: 12_000 },
    },
    tools: [{
      type: 'mcp',
      server_label: 'support',
      connector_id: 'conn_support_mcp',
      allowed_tools: { read_only: true },
      require_approval: 'never',
      defer_loading: true,
    }],
  },
});
```

For a function tool sent directly to OpenAI, use the flattened Realtime shape:

```typescript
const lookupTool = {
  type: 'function' as const,
  name: 'lookup_order',
  description: 'Look up an order by id',
  parameters: {
    type: 'object',
    properties: { orderId: { type: 'string' } },
    required: ['orderId'],
    additionalProperties: false,
  },
};
```

Raw `OpenAIRealtimeSession` surfaces OpenAI tool-call events but deliberately
does not execute function tools. Use `OpenAIRealtimeAgentSession` or
`VoiceBridge` when local `ToolFunction`s should execute with the full Agent
lifecycle. Remote MCP tools remain provider-executed; the agent-aware surfaces
answer approval requests through `approveMCP` and reject them when no handler is
configured.

### Voice-Agent Models

| Model | Use | Context/output | Registry status |
|-------|-----|----------------|-----------------|
| `gpt-realtime-2.1` | Most capable production voice agent; reasoning, vision, audio, tools | 128K / 32K | Active, preferred |
| `gpt-realtime-2.1-mini` | Faster and lower cost; reasoning, vision, audio, tools | 128K / 32K | Active |
| `gpt-realtime-2` | Realtime reasoning and tool workflows | 128K / 32K | Active |
| `gpt-realtime-translate` | Dedicated continuous interpreter | 16K / 2K | Active; translation endpoint only |
| `gpt-realtime-1.5` | Previous-generation realtime voice model | 32K / 4K | Active |
| `gpt-realtime`, `gpt-realtime-mini` | Legacy compatibility | 32K / 4K | Deprecated but callable until 2027-01-20 |

Realtime voices are `alloy`, `ash`, `ballad`, `coral`, `echo`, `marin`, `sage`,
`shimmer`, `verse`, and `cedar`; custom `{ id: 'voice_…' }` references are also
accepted by the session type. OpenAI recommends `marin` or `cedar` for best
quality, and `VoiceBridge` defaults to `marin`. Select the voice before the model
first emits audio; OpenAI does not allow changing it later in the same session.

### Realtime Transcription

Use a transcription session when the application needs streaming text without
an assistant response. The connection uses `intent=transcription`; the actual
transcription model belongs in `session.audio.input.transcription.model`.
OneRingAI applies that distinction automatically.

```typescript
const transcription = new OpenAIRealtimeSession({
  connector: 'openai',
  session: {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        noise_reduction: { type: 'near_field' },
        transcription: {
          model: 'gpt-live-transcribe',
          prompt: 'Customer support call about account AC-42.',
          keywords: ['AC-42', 'premium plan', 'billing'],
          languages: ['en', 'fr'],
          delay: 'low',
        },
        turn_detection: null,
      },
    },
  },
});

transcription.on('event', (event) => {
  if (event.type === 'conversation.item.input_audio_transcription.delta') {
    process.stdout.write(event.delta);
  }
  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    console.log('\nfinal:', event.transcript);
  }
});

await transcription.connect();
transcription.appendAudio(pcm24Chunk);
transcription.commitAudio();
```

`gpt-live-transcribe` is the recommended streaming model. The registry also
includes `gpt-realtime-whisper`; both are priced at $0.017 per audio minute.
Use `languages` for multiple expected languages and do not combine it with the
singular `language` field. With automatic VAD enabled, the server can commit
turns; with `turn_detection: null`, the host commits them explicitly.

Completion events from separate turns are not guaranteed to arrive in order.
Use `item_id` and `content_index` to reconcile partial and final transcripts.
Live transcription does not provide word-level timestamps, speaker labels, or
confidence scores; use a compatible file-transcription workflow when those are
required.

### Realtime Translation

Translation is a dedicated continuous protocol, not a voice-agent prompt. It
uses `gpt-realtime-translate` and `/v1/realtime/translations`. Do not call
`createResponse()` or wait for a conversation turn: keep appending source audio,
including silence between phrases, and consume translated output as it arrives.

```typescript
const translation = new OpenAIRealtimeSession({
  connector: 'openai',
  model: 'gpt-realtime-translate', // also selects realtime/translations
  session: {
    audio: {
      output: { language: 'es' },
    },
  },
});

translation.on('event', (event) => {
  if (event.type === 'session.input_transcript.delta') {
    updateSourceCaption(event.delta);
  }
  if (event.type === 'session.output_transcript.delta') {
    updateSpanishCaption(event.delta);
  }
  if (event.type === 'session.output_audio.delta') {
    playPcm24(Buffer.from(event.delta, 'base64'));
  }
  if (event.type === 'session.closed') {
    translation.close();
  }
});

await translation.connect();
translation.appendAudio(pcm24Chunk);

// At end of source media, flush pending translation before closing the socket.
translation.closeTranslation();
```

The WebSocket `session.update` translation shape contains only the target output
language. The WebRTC client-secret shape additionally requires
`model: 'gpt-realtime-translate'`; the library exposes separate TypeScript types
so the two wire contracts cannot be accidentally mixed.

Use one translation session per output language. For two-way interpretation,
keep participant tracks separate and create one session per direction. For
WebSocket media, source audio is base64 24 kHz PCM16. For browser media, WebRTC
handles capture and playback as media tracks.

### Browser and Mobile WebRTC Credentials

Create ephemeral credentials on your server and return only the short-lived
secret to the client. `expiresAfterSeconds` must be between 10 and 7,200.

```typescript
const api = new OpenAIRealtimeAPI('openai');

// Voice-agent or transcription credential.
const voiceSecret = await api.createClientSecret({
  session: {
    type: 'realtime',
    model: 'gpt-realtime-2.1-mini',
    instructions: 'Answer briefly.',
    audio: { output: { voice: 'marin' } },
  },
  expiresAfterSeconds: 600,
  safetyIdentifier: hashUserId('user-123'),
});

// Translation has a separate credential endpoint and session shape.
const translationSecret = await api.createTranslationClientSecret({
  session: {
    model: 'gpt-realtime-translate',
    audio: { output: { language: 'de' } },
  },
  safetyIdentifier: hashUserId('user-123'),
});

// Trusted-server WebRTC setup can exchange an SDP offer directly.
const { sdp: sdpAnswer, callId } = await api.createWebRTCCallWithMetadata({
  sdp: browserOffer.sdp!,
  session: {
    model: 'gpt-realtime-2.1',
    audio: { output: { voice: 'marin' } },
  },
  safetyIdentifier: hashUserId('user-123'),
});

// Apply sdpAnswer in the peer. A server-owned Agent can join by call ID:
const serverAgentSession = new OpenAIRealtimeAgentSession({ agent, callId });
await serverAgentSession.connect();
// Send `voiceSecret.value` or `translationSecret.value` only to the intended client.
```

`createWebRTCCall()` remains source-compatible with earlier OneRingAI releases
and returns only the SDP answer string. Use `createWebRTCCallWithMetadata()`
when the caller also needs the opaque call ID for sideband control or hangup.

The browser-safe `OpenAIRealtimeWebRTCPeer` creates an `RTCPeerConnection`, adds
its microphone track, creates the `oai-events` data channel, and exchanges SDP
through a host callback. It intentionally accepts no provider credential. The
full Agent can remain in an Electron main process and consume the bridged data
channel through `OpenAIRealtimeChannelTransport`. Use `/v1/realtime/calls` for a voice-agent SDP offer and
`/v1/realtime/translations/calls` for translation.

```typescript
// Renderer or browser-safe bundle
import { OpenAIRealtimeWebRTCPeer } from '@everworker/oneringai/realtime-browser';

const peer = new OpenAIRealtimeWebRTCPeer({
  exchangeSdp: (offer, { signal }) => appBackend.createRealtimeCall({ offer, signal }),
  releaseCall: (callId) => appBackend.hangupRealtimeCall({ callId }),
  onRemoteTrack: (streamOrTrack) => {
    if (typeof MediaStream !== 'undefined' && streamOrTrack instanceof MediaStream) {
      audioElement.srcObject = streamOrTrack;
    }
  },
});
await peer.connect();

// On explicit shutdown, wait until both local media and the provider call end.
await peer.closeAndRelease();
```

`exchangeSdp` must return `{ sdp, callId }`; the old string-only answer is not
accepted because it cannot support reliable cleanup. Before the first message
subscriber, the peer retains at most 256 events or 1 MiB by default. Before
`connect()`, `OpenAIRealtimeChannelTransport` independently retains at most
256 events or 1 MiB. Configure these with `maxPendingMessages`,
`maxPendingMessageBytes`, `maxPendingEvents`, and `maxPendingEventBytes`.
Overflow closes or fails the session instead of dropping an older ordered
event. Bridges that implement their own channel should preserve the same
ordering and may use `getSessionCreatedMessage()` for compatibility with
creation-event replay.

Never send the connector's standard API key to a browser or mobile application.
Mint client secrets per session and associate the safety identifier when the
secret is created.

### SIP Call Control

`OpenAIRealtimeAPI` also wraps server-side controls for an OpenAI SIP call. The
`callId` normally comes from the incoming-call webhook event.

```typescript
const api = new OpenAIRealtimeAPI('openai');

await api.acceptCall(callId, {
  model: 'gpt-realtime-2.1',
  instructions: 'You are Acme telephone support.',
  audio: { output: { voice: 'cedar' } },
});

// Reject an unanswered call (486 = busy, for example).
await api.rejectCall(callId, 486);

// Transfer an accepted call.
await api.referCall(callId, 'sip:human-agent@example.com');

// End an accepted call.
await api.hangupCall(callId);
```

Webhook signature validation, replay protection, routing policy, and mapping the
incoming payload to `callId` remain host responsibilities. Accept/reject/refer/
hangup calls are authenticated through the selected connector.

### `VoiceBridge` Realtime Telephony

For Twilio Media Streams, use `VoiceBridge` with `pipeline: 'realtime'`. It
creates a fresh full `Agent` per call, translates agent instructions and enabled
local tools into the Realtime session, streams native PCMU in both directions,
executes tool calls through the full Agent lifecycle, refreshes context before
every response, maintains a transcript and cumulative usage, and handles
interruption timing and truncation.

```typescript
import {
  TwilioAdapter,
  VoiceBridge,
} from '@everworker/oneringai';

const bridge = VoiceBridge.create({
  agent: {
    connector: 'openai',
    model: 'gpt-realtime-2.1',
    instructions: 'Be a concise and helpful phone support agent.',
    tools: [lookupOrder, createTicket],
    permissions: {
      onApprovalRequired: approveVoiceTool,
    },
  },
  pipeline: 'realtime',
  voice: 'marin',
  speed: 1,
  turnDetection: 'semantic_vad',
  semanticVADEagerness: 'auto',
  noiseReduction: 'far_field',
  inputTranscription: true,
  transcriptionModel: 'gpt-4o-transcribe',
  interruptible: true,
  greeting: 'Hello, this is Acme support. How can I help?',
  greetingOutbound: 'Hello, I am calling from Acme support.',
  safetyIdentifier: hashUserId('caller-123'),
  maxConcurrentCalls: 20,
  maxCallDuration: 3600,
  realtime: {
    reasoning: { effort: 'low' },
    tracing: { workflow_name: 'twilio-support' },
    truncation: { type: 'retention_ratio', retention_ratio: 0.8 },
  },
  approveMCP: async (request, session) =>
    authorizeHostedVoiceTool(session.callId, request),
  hooks: {
    onCallStart: async (session) => isAllowedCaller(session.from),
    onInterrupt: async (session) => audit('interrupt', session.sessionId),
    onCallEnd: async (session, summary) => saveCallSummary(session, summary),
    onError: async (error, session) => reportCallError(error, session),
  },
});

const twilio = TwilioAdapter.createStandalone({
  connector: 'twilio',
  port: 3000,
  publicUrl: 'https://voice.example.com',
});

bridge.on('transcript', (session, entry) => {
  console.log(session.callId, entry.role, entry.text);
});

bridge.attach(twilio);
await twilio.start();
```

When the effective Agent depends on caller or tenant context, replace the
static `agent` object with a per-call factory:

```typescript
const bridge = VoiceBridge.create({
  agentFactory: async (session) => resolveAuthorizedAgent(session),
  pipeline: 'realtime',
  voice: 'marin',
});
```

The factory must return a new Agent. `VoiceSession` owns and destroys it.

Realtime `beforeAgentResponse` and `afterAgentResponse` hooks are observational:
the model has already consumed or generated audio concurrently, so returned text
cannot rewrite that audio. Use agent instructions, tools, or session controls to
change realtime behavior. `onCallStart`, `onInterrupt`, `onError`, and
`onCallEnd` retain their normal lifecycle semantics.

`VoiceBridge` realtime configuration:

| Option | Default | Meaning |
|--------|---------|---------|
| `voice` | `marin` | Realtime output voice |
| `speed` | `1` | Output speed, 0.25–1.5 |
| `turnDetection` | `server_vad` | `server_vad`, `semantic_vad`, or `none` for local VAD |
| `vadThreshold` | `0.5` | Server VAD sensitivity |
| `silenceDurationMs` | `500` | Silence before server-VAD turn completion |
| `prefixPaddingMs` | `400` | Audio retained before detected speech |
| `idleTimeoutMs` | unset | Optional server-VAD idle prompt timeout |
| `semanticVADEagerness` | `auto` | Semantic end-of-turn eagerness |
| `noiseReduction` | `near_field` | `near_field`, `far_field`, or `none` |
| `inputTranscription` | `true` | Caller transcripts for hooks, context, and UI |
| `transcriptionModel` | `gpt-4o-transcribe` | Input transcription model |
| `transcriptionLanguage` | unset | Optional language hint |
| `interruptible` | `true` | Permit caller barge-in |
| `realtime` | `{}` | Advanced GA session options; agent instructions/tools are merged |
| `safetyIdentifier` | unset | Privacy-preserving OpenAI end-user identifier |
| `approveMCP` | reject | Approval callback for provider-hosted MCP requests |

With input transcription enabled, the OpenAI bridge refreshes Agent context and
tools before every response. Setting `inputTranscription: false` intentionally
falls back to initial-only context synchronization and preserves OpenAI's normal
server/manual response creation.

When `turnDetection: 'none'`, `VoiceBridge` uses local `EnergyVAD`, commits the
audio buffer, and requests each response itself. The existing `vad` and
`silenceTimeout` options configure that local detector. Server and semantic VAD
do not use `EnergyVAD`.

On barge-in, the pipeline cancels the active model response, clears queued
telephony playback, and truncates the assistant conversation item at the media
timestamp actually reached by the caller. Tool calls and results are added to
the bridge transcript as `tool_use` and `tool_result` entries.

### Tool Security

There are two distinct tool paths:

1. **Local OneRingAI tools** are supplied through `agent.tools`.
   `OpenAIRealtimeAgentSession` and `VoiceBridge` execute them through the normal
   Agent lifecycle, including permission policy, user rules, before/approve/after
   hooks, circuit breakers, tool context, limits, cancellation, events, and metrics.
2. **Provider-hosted MCP tools** are supplied through `realtime.tools`. They run
   through OpenAI's Realtime tool path. Configure connector authorization and
   allowed tools explicitly; approval requests fail closed unless `approveMCP`
   returns an affirmative decision.

Do not place long-lived secrets directly in model-visible tool definitions.
Prefer an OpenAI-managed connector reference (`connector_id`) or resolve
credentials on the trusted server. This field is an OpenAI connector id, not a
OneRingAI connector-registry name. Treat third-party MCP data movement as an
explicit trust decision.

### Realtime Cost Estimation

Realtime voice-agent models have separate text, audio, and image token prices.
Select the modality when calculating cost. Translation is billed by audio
duration rather than tokens.

```typescript
import { calculateCost } from '@everworker/oneringai';

const audioTokenCost = calculateCost(
  'gpt-realtime-2.1',
  12_000,
  4_000,
  {
    modality: 'audio',
    cachedInputTokens: 2_000,
  },
);

const translationCost = calculateCost(
  'gpt-realtime-translate',
  0,
  0,
  { audioMinutes: 15 },
); // $0.51 at $0.034/minute
```

If `gpt-realtime-translate` is used without `audioMinutes`, `calculateCost()`
returns `null`. Image output cost is also `null` when the registry has no image
output price. Inspect `getModelInfo(model).features.pricing` for the exact
modality metadata used by the calculator.

### Production Checklist and Boundaries

- Use WebRTC for browser/mobile capture and playback; use WebSocket when a
  trusted server already owns raw audio.
- Never expose the standard OpenAI connector token to a client. Mint a new
  ephemeral secret for each WebRTC session.
- Set `safetyIdentifier` to a stable privacy-preserving value per end user.
- Benchmark VAD, noise reduction, reasoning effort, latency, interruption, and
  reconnect behavior with real microphones, accents, network conditions, and
  telephony audio.
- Handle the raw `error` event payload and socket-level `error` separately.
- Observe `backpressure` and do not queue unbounded raw audio; the WebSocket
  transport rejects new audio frames after `maxBufferedAmountBytes` (1 MiB by default).
- Recreate or hand off the session when `session:expiring` fires. The default
  warning is at 55 minutes, before OpenAI's hard 60-minute session limit.
- To carry semantic context across that boundary, first close the old
  `OpenAIRealtimeAgentSession` (releasing its external-execution lease), then
  call `agent.rolloverContext({ reason: 'realtime-session-expiring' })`, and
  create the replacement session with the same Agent. The rollover preserves
  eight recent user turns exactly by default, never splits tool-call pairs,
  preserves plugin state and the full history journal, and checkpoints when
  session storage is configured. If the Agent's configured model cannot make a
  normal text generation call, pass a trusted `summarize` callback backed by a
  text-capable Agent or server proxy.
- Stop local playback when cancelling a response; keep server conversation state
  aligned with `truncateItem()`.
- For translation, send `closeTranslation()`, continue reading until
  `session.closed`, and only then close the socket.
- Reconcile transcription turns by `item_id`, not event arrival order.
- Apply normal OneRingAI permission policies to every local tool used by a phone
  or voice agent.
- Validate SIP webhook signatures and make accept/refer decisions on a trusted
  server.
- Record consent and disclosures where call recording, transcription, synthetic
  speech, or automated calling laws require them.

The library's WebSocket client transports raw audio but does not capture a
microphone or play sound. The WebRTC helper mints credentials but does not manage
`RTCPeerConnection`. SIP helpers control an existing OpenAI call but do not
provision phone numbers or receive webhooks. `VoiceBridge` supplies those media
and lifecycle integrations for supported telephony adapters.

### xAI Realtime Voice Agent API

xAI's Voice Agent API is wire-compatible with the OpenAI Realtime protocol, so
`GrokRealtimeSession`, `RealtimePipeline`, and `VoiceBridge` select xAI behavior
from a `Vendor.Grok` connector. `grok-voice-latest` currently resolves through
the registry to `grok-voice-think-fast-2.0`.

```typescript
import {
  Connector,
  GrokRealtimeAPI,
  GrokRealtimeSession,
  Vendor,
} from '@everworker/oneringai';

Connector.create({
  name: 'xai',
  vendor: Vendor.Grok,
  auth: { type: 'api_key', apiKey: process.env.XAI_API_KEY! },
});

const voice = new GrokRealtimeSession({
  connector: 'xai',
  model: 'grok-voice-latest',
  reasoningEffort: 'high', // handshake option: 'high' or 'none'
  session: {
    instructions: 'Be concise and helpful.',
    voice: 'eve',
    turn_detection: { type: 'server_vad' },
    resumption: { enabled: true },
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 32000 },
        transport: 'binary',
        transcription: {
          language_hint: 'en',
          keyterms: ['OneRingAI'],
        },
      },
      output: {
        format: { type: 'audio/pcm', rate: 32000 },
        transport: 'binary',
        speed: 1,
      },
    },
  },
});

voice.on('event', (event) => {
  if (event.type === 'response.output_audio.delta') playBase64(event.delta);
});
await voice.connect();
```

Unlike OpenAI's Realtime session shape, xAI requires `voice` and
`turn_detection` directly under `session`. Transcription uses
`session.audio.input.transcription.language_hint` (not `language`).
`RealtimePipeline` and `VoiceBridge` translate their normalized options to this
xAI layout automatically.

Set `audio.input.transport` or `audio.output.transport` to `binary` to use raw
WebSocket frames. `appendAudio(Buffer)` then sends binary input directly and the
session emits the typed `audio` event for binary assistant frames. JSON remains
the default and is the transport used by `RealtimePipeline`.

xAI accepts PCM sample rates of 8,000, 16,000, 22,050, 24,000, 32,000, 44,100,
and 48,000 Hz for both input and output. PCMU/PCMA keep their native telephony
rate. `GrokRealtimeSessionConfig` represents that range; the OpenAI session
type and runtime boundary remain fixed at 24,000 Hz.

Resume a disconnected conversation by constructing a new session with the
previous `conversationId`. For inbound SIP, pass `callId`; the model query is
then omitted because the call already owns its session.

Browser clients must use an ephemeral secret instead of exposing the team API key:

```typescript
const api = new GrokRealtimeAPI('xai');
const secret = await api.createClientSecret(300);

await api.referCall('call_123', 'tel:+14155550123');
await api.hangupCall('call_123');
```

xAI also supports MCP, hosted web/X/collections search, custom functions,
pronunciation replacement, language hints, keyterms, Opus/PCM/G.711 codecs,
custom voices, session resumption, and SIP. Provider-specific session fields can
be sent through the typed session shape where represented or via raw protocol
events with `send()`.

xAI currently accepts `server_vad` or disabled turn detection. Do not reuse an
OpenAI `semantic_vad` configuration for a Grok session: `RealtimePipeline`
rejects it during initialization so an unsupported session update never reaches
the provider.

### Public Realtime Exports

The package root exports:

- runtime classes: `OpenAIRealtimeAgentSession`, `OpenAIRealtimeSession`, `OpenAIRealtimeAPI`,
  `OpenAIRealtimeChannelTransport`,
  `GrokRealtimeSession`, `GrokRealtimeAPI`, `RealtimePipeline`, and
  `VoiceBridge`;
- session/API types: `OpenAIRealtimeSessionOptions`,
  `OpenAIRealtimeAgentSessionOptions`, `OpenAIRealtimeAgentTransport`,
  `OpenAIRealtimeChannelTransportOptions`,
  `CreateRealtimeClientSecretOptions`, and
  `CreateRealtimeTranslationClientSecretOptions`, and
  `CreateRealtimeWebRTCCallOptions`, `OpenAIRealtimeWebRTCCall`, and
  `RealtimeMessageChannel`;
- configuration types: `OpenAIRealtimeSessionConfig`,
  `OpenAIRealtimeTranscriptionSessionConfig`,
  `OpenAIRealtimeTranslationSessionConfig`, and
  `OpenAIRealtimeTranslationClientSessionConfig`, plus
  `GrokRealtimeSessionConfig`;
- audio types: `OpenAIRealtimePCMSampleRate`, `RealtimePCMSampleRate`,
  `OpenAIRealtimeAudioFormat`, and `GrokRealtimeAudioFormat`;
- protocol types: `OpenAIRealtimeClientEvent`,
  `OpenAIRealtimeServerEvent`, `OpenAIRealtimeClientSecret`, audio/VAD types,
  function/MCP tool types, voices, and model ids; and
- telephony types: `RealtimePipelineConfig`, `VoiceBridgeConfig`, `VoiceAgentFactory`,
  `VoicePipelineEvents`, `TranscriptMessage`, and adapter/session types.

The browser-only `@everworker/oneringai/realtime-browser` subpath exports
`OpenAIRealtimeWebRTCPeer`, `OpenAIRealtimeWebRTCPeerOptions`, its event
types, and the shared Realtime channel/event types without loading the Node.js
SDK entry point.

Run the complete server-side example with:

```bash
npm run example:realtime
```

OpenAI reference material: [Realtime overview](https://developers.openai.com/api/docs/guides/realtime),
[WebSocket](https://developers.openai.com/api/docs/guides/realtime-websocket),
[WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc),
[transcription](https://developers.openai.com/api/docs/guides/realtime-transcription),
[translation](https://developers.openai.com/api/docs/guides/realtime-translation),
and [SIP](https://developers.openai.com/api/docs/guides/realtime-sip).

---

## Image Generation

The unified image API supports current OpenAI GPT Image, Google Gemini native-image, and xAI Grok Imagine generation and editing. The high-level helper defaults to `gpt-image-2`, `gemini-3.1-flash-image`, or `grok-imagine-image-2.0` according to the connector vendor.

### Basic Usage

```typescript
import { Connector, ImageGeneration, Vendor } from '@everworker/oneringai';
import * as fs from 'fs/promises';

// Setup connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create image generator
const imageGen = ImageGeneration.create({ connector: 'openai' });

// Generate an image
const result = await imageGen.generate({
  prompt: 'A futuristic city at sunset with flying cars',
  model: 'gpt-image-2',       // optional: current vendor default
  size: '1024x1024',
  quality: 'high',
  vendorOptions: { output_format: 'png' },
});

// Save to file
const buffer = Buffer.from(result.data[0].b64_json!, 'base64');
await fs.writeFile('./output.png', buffer);
```

### OpenAI GPT Image

```typescript
// GPT Image 2 is the current default for generation and editing.
const result = await imageGen.generate({
  prompt: 'A serene mountain landscape',
  model: 'gpt-image-2',
  size: '1536x1024',
  quality: 'high',         // auto, low, medium, high
  vendorOptions: {
    output_format: 'webp',
    background: 'opaque',
  },
});

// The high-level edit API also selects GPT Image 2 when model is omitted.
const edited = await imageGen.edit({
  image: './source.png',
  prompt: 'Keep the composition and change the weather to snowfall',
  vendorOptions: { input_fidelity: 'high' },
});
```

`dall-e-2` and `dall-e-3` remain in the registry as retired records for migration and historical cost lookup; do not use them in new integrations.

### Google Gemini native image

```typescript
// Setup Google connector
Connector.create({
  name: 'google',
  vendor: Vendor.Google,
  auth: { type: 'api_key', apiKey: process.env.GOOGLE_API_KEY! },
});

const googleGen = ImageGeneration.create({ connector: 'google' });

// Nano Banana 2: current general-purpose native image model.
const result = await googleGen.generate({
  prompt: 'A beautiful butterfly in a garden',
  model: 'gemini-3.1-flash-image',
  size: '2048x2048',
  aspectRatio: '16:9',
  n: 2,
});

// Nano Banana 2 Lite: low-latency 1K generation and editing.
const fastResult = await googleGen.generate({
  prompt: 'A simple geometric pattern',
  model: 'gemini-3.1-flash-lite-image',
});

// Nano Banana Pro: complex layouts and professional 4K output.
const proResult = await googleGen.generate({
  prompt: 'A photorealistic portrait',
  model: 'gemini-3-pro-image',
  vendorOptions: { imageSize: '4096px' },
});
```

Normalized square sizes map to Gemini's native values: `512x512` → `512`,
`1024x1024` → `1K`, `2048x2048` → `2K`, and `4096x4096` → `4K`; `auto`
leaves resolution selection to Google. Current native image models reject
`candidateCount > 1`, so OneRingAI implements `n` (up to the registry limit of
four) as bounded parallel `generateContent` requests. Image edits infer PNG,
JPEG, WebP, or GIF MIME types from the source path or bytes.

### xAI Grok Imagine

```typescript
Connector.create({
  name: 'xai',
  vendor: Vendor.Grok,
  auth: { type: 'api_key', apiKey: process.env.XAI_API_KEY! },
});

const grokImages = ImageGeneration.create({ connector: 'xai' });
const result = await grokImages.generate({
  prompt: 'Editorial product photograph on a cobalt background',
  model: 'grok-imagine-image-2.0',
  aspectRatio: '4:3',
  vendorOptions: {
    resolution: '2K',
    quality: 'medium',
    storage_options: { public: true },
  },
});
// Responses may include b64_json/url plus xAI file_id/public_url metadata.
```

### Current Image Models

The table highlights current non-retired choices. The image registry contains
20 records in total, including callable migration entries and retired records;
use `getActiveImageModels()` and `getDeprecatedImageModels()` rather than
hard-coding this table in a model picker.

| Vendor | Model | Lifecycle | Main use | Pricing representation |
|--------|-------|-----------|----------|------------------------|
| OpenAI | `gpt-image-2` | Active, preferred | High-quality generation/editing, transparent output | Text/image input and image-output tokens |
| Google | `gemini-3.1-flash-image` | Active, preferred | General generation/editing up to 4K | $0.045-$0.151 by resolution |
| Google | `gemini-3.1-flash-lite-image` | Active, preferred | Low-latency 1K work | $0.0336/image |
| Google | `gemini-3-pro-image` | Active | Professional design and 4K | $0.134-$0.24/image |
| xAI | `grok-imagine-image-2.0` | Active, preferred | Current generation/editing with quality tiers | $0.04-$0.08; $0.01/input image |
| xAI | `grok-imagine-image-quality` | Active | Previous higher-fidelity generation/editing | $0.05 at 1K, $0.07 at 2K; $0.01/input image |
| xAI | `grok-imagine-image` | Active | Fast generation/editing | $0.02/image |

Use `getActiveImageModels()` for callable entries and `getDeprecatedImageModels()` for still-callable models with a migration notice. Retired records remain queryable but are excluded from the active helper.

### Model Introspection

```typescript
// List available models
const models = await imageGen.listModels();
console.log('Available models:', models);

// Get model information
const info = imageGen.getModelInfo('gpt-image-2');
console.log('Max images:', info.capabilities.maxImagesPerRequest);
console.log('Supported sizes:', info.capabilities.sizes);
console.log('Lifecycle:', info.lifecycle);
console.log('Official docs:', info.sources?.documentation);
```

### Cost Estimation

```typescript
import { calculateImageCost } from '@everworker/oneringai';

// GPT Image 2 uses actual modality-token usage.
const openaiCost = calculateImageCost('gpt-image-2', 1, {
  textInputTokens: 100_000,
  cachedImageInputTokens: 200_000,
  imageOutputTokens: 300_000,
});
console.log(openaiCost); // 9.9

// Resolution and input-image accounting for current models.
const googleCost = calculateImageCost('gemini-3.1-flash-image', 2, {
  resolution: '2048px',
  textInputTokens: 1_000,
});
console.log(googleCost); // 0.2025 (two images plus known text-input usage)

const xaiCost = calculateImageCost('grok-imagine-image-2.0', 2, {
  resolution: '2K-medium',
  inputImages: 1,
});
console.log(xaiCost); // 0.15
```

Token fields are composable. Supplying only text or image-input token usage
adds that known cost to the registry's per-image output estimate; per-image
output pricing is replaced only when `imageOutputTokens` is supplied.

---

## Embeddings

The library provides multi-vendor text embeddings and Google Gemini Embedding 2 multimodal embeddings through one API. Text, image, audio, video, and document inputs can share one vector space for semantic search, RAG, clustering, classification, and similarity matching.

### Basic Usage

```typescript
import { Connector, Embeddings, Vendor } from '@everworker/oneringai';

// Setup connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create embeddings instance
const embeddings = Embeddings.create({ connector: 'openai' });

// Embed a single text
const result = await embeddings.embed('Hello world');
console.log(result.embeddings[0].length);  // 1536
console.log(result.usage.promptTokens);    // 2

// Embed multiple texts (batch)
const batch = await embeddings.embed([
  'The quick brown fox',
  'A lazy dog sleeps',
  'Machine learning is powerful',
]);
console.log(batch.embeddings.length);  // 3
```

### Matryoshka Representation Learning (MRL)

Models that support MRL (marked with `matryoshka: true` in the registry) allow you to request fewer output dimensions. This produces smaller vectors for faster similarity search with minimal quality loss.

```typescript
// Full dimensions (default)
const full = await embeddings.embed('Hello world');
console.log(full.embeddings[0].length);  // 1536

// Reduced dimensions — 3x smaller vectors, ~1% quality loss
const compact = await embeddings.embed('Hello world', { dimensions: 512 });
console.log(compact.embeddings[0].length);  // 512

// Even smaller — great for large-scale approximate search
const tiny = await embeddings.embed('Hello world', { dimensions: 128 });
console.log(tiny.embeddings[0].length);  // 128
```

Models with MRL support include `text-embedding-3-small`, `text-embedding-3-large`, `gemini-embedding-2`, `gemini-embedding-001`, `codestral-embed`, `embeddinggemma`, all `qwen3-embedding` variants, and `nomic-embed-text`.

### Default Dimensions

You can set default dimensions at creation time:

```typescript
// All embeddings from this instance use 512 dimensions
const embeddings = Embeddings.create({
  connector: 'openai',
  model: 'text-embedding-3-small',
  dimensions: 512,
});

const result = await embeddings.embed('Hello');
console.log(result.embeddings[0].length);  // 512

// Override per-call
const full = await embeddings.embed('Hello', { dimensions: 1536 });
console.log(full.embeddings[0].length);  // 1536
```

### OpenAI Embeddings

```typescript
// text-embedding-3-small (recommended — cost-efficient, MRL)
const result = await embeddings.embed('search query', {
  model: 'text-embedding-3-small',
  dimensions: 1536,  // default, can reduce to 512 or 256
});

// text-embedding-3-large (higher quality, more dimensions)
const large = await embeddings.embed('search query', {
  model: 'text-embedding-3-large',
  dimensions: 3072,  // default, can reduce
});
```

### Google Embeddings

```typescript
Connector.create({
  name: 'google',
  vendor: Vendor.Google,
  auth: { type: 'api_key', apiKey: process.env.GOOGLE_API_KEY! },
});

const googleEmb = Embeddings.create({ connector: 'google' });

// gemini-embedding-2 is the current Google default (3072 dimensions).
const result = await googleEmb.embed('search query');
console.log(result.embeddings[0].length);  // 3072

// Task-aware text embedding with dimension reduction.
const compact = await googleEmb.embed('search query', {
  dimensions: 512,
  vendorOptions: {
    taskType: 'RETRIEVAL_QUERY',
    title: 'Product documentation query',
  },
});

// Multimodal content is exposed directly by the high-level API.
const mixed = await googleEmb.embedMultimodal([
  { type: 'text', text: 'Find assets similar to this launch brief' },
  { type: 'image', data: './campaign.png', mimeType: 'image/png' },
  { type: 'document', data: './brief.pdf', mimeType: 'application/pdf' },
], {
  dimensions: 1024,
  vendorOptions: { taskType: 'RETRIEVAL_DOCUMENT' },
});
```

`embedMultimodal()` currently requires `gemini-embedding-2`; the provider
rejects multimodal content for text-only models. `Buffer`, local-path, data-URI,
and arbitrary HTTP(S) inputs are sent inline; HTTP(S) content is fetched first
with a 30-second default timeout and a streaming size guard. One request has a
100 MB aggregate inline-media budget; an individual PDF is limited to 50 MB.
`Content-Length` is rejected before reading when present, and chunked responses
are stopped as soon as they cross the budget. Configure a different positive
timeout with `vendorOptions.mediaDownloadTimeoutMs`; the provider size ceilings
remain fixed to Google's API contract. Only `gs://` and Gemini Files API URIs
are emitted as provider-hosted `fileData` references. Data URIs are strictly
validated as base64, checked against the remaining byte budget before decoding,
and re-encoded canonically before transmission.

`mimeType` is optional. Explicit values take precedence; otherwise the provider
inspects common JPEG/PNG/BMP/WebP, WAV/AIFF/MP3/AAC/FLAC/Ogg/WebM/MP4, MOV/MP4/
AVI/WebM/MPEG/3GP, and PDF signatures before falling back to the path extension.
This keeps JPEG buffers out of `image/png`, MP3 buffers out of `audio/wav`, and
MOV files out of `video/mp4`.

### Ollama Embeddings (Local)

Run embedding models locally with Ollama — free, private, no API key required.

```typescript
Connector.create({
  name: 'ollama-local',
  vendor: Vendor.Ollama,
  auth: { type: 'none' },
  baseURL: 'http://localhost:11434/v1',
});

const local = Embeddings.create({ connector: 'ollama-local' });

// embeddinggemma (default) — compact multilingual model, 768 dims
const result = await local.embed('semantic search query');
console.log(result.embeddings[0].length);  // 768

// Use smaller model for constrained environments
const light = await local.embed('query', {
  model: 'qwen3-embedding:0.6b',  // ~400MB, 1024 dims
});

// Use nomic-embed-text for 768-dim vectors
const nomic = await local.embed('query', {
  model: 'nomic-embed-text',
});
```

**Recommended Ollama embedding models by system RAM:**

| RAM | Model | Size | Dimensions | Quality |
|-----|-------|------|------------|---------|
| < 12 GB | `qwen3-embedding:0.6b` | ~400 MB | 1024 | Good |
| 12-24 GB | `qwen3-embedding:4b` | ~2.5 GB | 4096 | Very good |
| 24+ GB | `qwen3-embedding` | ~5 GB | 4096 | Best (MTEB #1) |

### Available Models

The table lists the 14 callable embedding models. The 15-record registry also
retains retired `text-embedding-004` for lookup and migration metadata.

| Vendor | Model | Default Dims | Max Dims | MRL | Max Tokens | Price/1M Tokens |
|--------|-------|-------------|----------|-----|------------|-----------------|
| OpenAI | `text-embedding-3-small` | 1536 | 1536 | Yes | 8,191 | $0.02 |
| OpenAI | `text-embedding-3-large` | 3072 | 3072 | Yes | 8,191 | $0.13 |
| OpenAI | `text-embedding-ada-002` | 1536 | 1536 | No | 8,191 | $0.10 (legacy) |
| Google | `gemini-embedding-2` | 3072 | 3072 | Yes | 8,192 | $0.20 text; modality-specific media rates |
| Google | `gemini-embedding-001` | 3072 | 3072 | Yes | 2,048 | $0.15 text |
| Mistral | `mistral-embed` | 1024 | 1024 | No | 8,192 | $0.10 |
| Mistral | `codestral-embed` | 3072 | 3072 | Yes | 8,192 | $0.15 |
| Ollama | `embeddinggemma` | 768 | 768 | Yes | 2,048 | Free (local) |
| Ollama | `all-minilm` | 384 | 384 | No | 512 | Free (local) |
| Ollama | `qwen3-embedding` | 4096 | 4096 | Yes | 8,192 | Free (local) |
| Ollama | `qwen3-embedding:4b` | 4096 | 4096 | Yes | 8,192 | Free (local) |
| Ollama | `qwen3-embedding:0.6b` | 1024 | 1024 | Yes | 8,192 | Free (local) |
| Ollama | `nomic-embed-text` | 768 | 768 | Yes | 8,192 | Free (local) |
| Ollama | `mxbai-embed-large` | 1024 | 1024 | No | 512 | Free (local) |

### Model Introspection

```typescript
import {
  getEmbeddingModelInfo,
  getEmbeddingModelsByVendor,
  getActiveEmbeddingModels,
  getEmbeddingModelsWithFeature,
  EMBEDDING_MODELS,
  Vendor,
} from '@everworker/oneringai';

// Get model information
const info = getEmbeddingModelInfo('text-embedding-3-small');
console.log(info.capabilities.maxDimensions);        // 1536
console.log(info.capabilities.maxTokens);            // 8191
console.log(info.capabilities.features.matryoshka);   // true
console.log(info.capabilities.features.multilingual);  // true
console.log(info.capabilities.limits.maxBatchSize);    // 2048

// List models by vendor
const ollamaModels = getEmbeddingModelsByVendor(Vendor.Ollama);
console.log(ollamaModels.map(m => m.name));
// ['embeddinggemma', 'all-minilm', 'qwen3-embedding', 'qwen3-embedding:4b', ...]

// Find MRL-capable models
const mrlModels = getEmbeddingModelsWithFeature('matryoshka');
console.log(mrlModels.map(m => `${m.name} (${m.capabilities.maxDimensions}d)`));

// Find multilingual models
const multilingualModels = getEmbeddingModelsWithFeature('multilingual');

// Use model constants for type safety
const modelName = EMBEDDING_MODELS[Vendor.OpenAI].TEXT_EMBEDDING_3_SMALL;
// 'text-embedding-3-small'
```

### Cost Estimation

```typescript
import { calculateEmbeddingCost } from '@everworker/oneringai';

// OpenAI text-embedding-3-small
const cost = calculateEmbeddingCost('text-embedding-3-small', 1_000_000);
console.log(`$${cost} per 1M tokens`);  // $0.02

// OpenAI text-embedding-3-large
const largeCost = calculateEmbeddingCost('text-embedding-3-large', 1_000_000);
console.log(`$${largeCost} per 1M tokens`);  // $0.13

// Ollama (free, returns null for no pricing)
const localCost = calculateEmbeddingCost('qwen3-embedding', 1_000_000);
console.log(localCost);  // null (free, local)

// Gemini Embedding 2 mixed-modality accounting plus the 50% batch discount.
const googleCost = calculateEmbeddingCost('gemini-embedding-2', 1_000_000, {
  images: 10,
  audioSeconds: 60,
  videoFrames: 30,
  batch: true,
});
console.log(googleCost); // 0.11725
```

### Common Use Cases

**Semantic Search (RAG):**
```typescript
// Embed documents at ingestion time
const docs = ['Document 1 text...', 'Document 2 text...', 'Document 3 text...'];
const docEmbeddings = await embeddings.embed(docs, { dimensions: 512 });
// Store docEmbeddings.embeddings in your vector database

// At query time, embed the query with the same model and dimensions
const queryResult = await embeddings.embed('user search query', { dimensions: 512 });
const queryVector = queryResult.embeddings[0];
// Use queryVector for vector similarity search
```

**Text Classification:**
```typescript
// Embed labeled examples and new text
const categories = await embeddings.embed([
  'sports news about football',
  'financial market analysis',
  'cooking recipe instructions',
]);

const newText = await embeddings.embed('The team scored in the final minute');
// Compare newText vector to category vectors using cosine similarity
```

---

## Video Generation

The unified asynchronous video API supports OpenAI Sora, Google Veo/Gemini Omni, and xAI Grok Imagine. Start a job, poll or wait for completion, then download through the same high-level surface.

### Basic Usage

```typescript
import { Connector, VideoGeneration, Vendor } from '@everworker/oneringai';
import * as fs from 'fs/promises';

// Setup connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Create video generator
const videoGen = VideoGeneration.create({ connector: 'openai' });

// Start video generation (returns immediately with job ID)
const job = await videoGen.generate({
  prompt: 'A cinematic shot of a sunrise over mountains with clouds rolling',
  model: 'sora-2',
  duration: 8,           // 8 seconds
  resolution: '1280x720', // 720p landscape
});

console.log('Job started:', job.jobId);
console.log('Status:', job.status);  // 'pending'

// Wait for completion (polls every 10 seconds, default 10-minute timeout)
const result = await videoGen.waitForCompletion(job.jobId);

// Download the completed video
const videoBuffer = await videoGen.download(job.jobId);
await fs.writeFile('./output.mp4', videoBuffer);
```

### Understanding the Async Model

Video generation takes significant time (often minutes). The API uses an async job model:

```typescript
// 1. Start generation - returns immediately
const job = await videoGen.generate({ prompt: '...', duration: 8 });
// job.status = 'pending'

// 2. Poll for status (optional - if you want progress updates)
const status = await videoGen.getStatus(job.jobId);
// status.status = 'processing', status.progress = 45

// 3. Wait for completion (blocks until done or timeout)
const result = await videoGen.waitForCompletion(job.jobId);
// result.status = 'completed'

// 4. Download the video
const buffer = await videoGen.download(job.jobId);
```

Or use the convenience method:

```typescript
// Generate and wait in one call
const result = await videoGen.generateAndWait({
  prompt: 'A butterfly flying through a garden',
  duration: 4,
});

const buffer = await videoGen.download(result.jobId);
```

### Video Response Structure

The API returns a `VideoResponse` object:

```typescript
interface VideoResponse {
  jobId: string;              // Unique job identifier
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created: number;            // Unix timestamp
  progress?: number;          // 0-100 percentage (when processing)
  video?: {
    url?: string;             // Download URL (if available)
    b64_json?: string;        // Base64-encoded video data (if provider returns inline)
    duration?: number;        // Actual duration in seconds
    resolution?: string;      // Actual resolution
    format?: string;          // 'mp4' typically
  };
  audio?: {                   // Separate audio track (if provider returns one)
    url?: string;
    b64_json?: string;
  };
  error?: string;             // Error message if failed
}
```

### Viewing Your Generated Video

After downloading, the video is a standard MP4 file that can be:

```typescript
// Save to file
await fs.writeFile('./output.mp4', videoBuffer);

// Open with default player (Node.js)
import { exec } from 'child_process';
exec('open ./output.mp4');  // macOS
exec('xdg-open ./output.mp4');  // Linux
exec('start ./output.mp4');  // Windows

// Serve via web server
import express from 'express';
const app = express();
app.get('/video', (req, res) => {
  res.setHeader('Content-Type', 'video/mp4');
  res.send(videoBuffer);
});

// Convert to base64 for embedding
const base64 = videoBuffer.toString('base64');
const dataUrl = `data:video/mp4;base64,${base64}`;
```

### OpenAI Sora

Sora 2 and Sora 2 Pro are still callable but have a published retirement date of 2026-09-24. The registry therefore reports `isActive: true` and `lifecycle: 'deprecated'`; use `getDeprecatedVideoModels()` to surface that state in production model pickers.

```typescript
// Sora 2 (callable during the deprecation window)
const result = await videoGen.generate({
  prompt: 'A futuristic city at sunset with flying cars',
  model: 'sora-2',
  duration: 8,              // 4, 8, 12, 16, or 20 seconds
  resolution: '1280x720',   // 720p landscape
  seed: 42,                 // For reproducibility
});

// Sora 2 Pro (higher quality, more options)
const proResult = await videoGen.generate({
  prompt: 'A photorealistic ocean wave crashing',
  model: 'sora-2-pro',
  duration: 12,
  resolution: '1792x1024',  // Landscape, 1.4x higher-resolution export
  seed: 42,
});

// Image-to-video (animate a still image)
const imageBuffer = await fs.readFile('./photo.jpg');
const animated = await videoGen.generate({
  prompt: 'Gentle camera pan across the landscape',
  image: imageBuffer,       // Reference image
  model: 'sora-2',
  duration: 4,
});
```

### Google Veo

```typescript
// Setup Google connector
Connector.create({
  name: 'google',
  vendor: Vendor.Google,
  auth: { type: 'api_key', apiKey: process.env.GOOGLE_API_KEY! },
});

const googleVideo = VideoGeneration.create({ connector: 'google' });

// Veo 3.1 Lite is the current high-level Google default.
const lite = await googleVideo.generate({
  prompt: 'A colorful butterfly landing on a flower',
  model: 'veo-3.1-lite-generate-preview',
  duration: 6,
  resolution: '1080p',
  vendorOptions: {
    negativePrompt: 'blurry, low quality',  // What to avoid
  },
});

// Veo 3.1 Fast (with audio support)
const veo3 = await googleVideo.generate({
  prompt: 'A thunderstorm over a city with lightning',
  model: 'veo-3.1-fast-generate-preview',
  duration: 8,
  vendorOptions: {
    personGeneration: 'dont_allow',  // Safety setting
  },
});

// Veo 3.1 (full feature set and 4K support)
const veo31 = await googleVideo.generate({
  prompt: 'A drone shot flying over mountains',
  model: 'veo-3.1-generate-preview',
  duration: 8,
  resolution: '4k',
});

// Gemini Omni uses the Interactions API for conversational video editing.
const omni = await googleVideo.generate({
  prompt: 'Animate this storyboard with a gentle dolly movement',
  model: 'gemini-omni-1.1-flash',
  image: './storyboard.png',
  duration: 6,
});
```

For Omni image-to-video, local paths, buffers, data URIs, and HTTP(S) source
images are normalized to inline image blocks with their detected PNG or JPEG
MIME type. The public `duration` option is serialized as
`response_format.duration` (for example, `"6s"`); it is not placed in
`generation_config.video_config`, whose public control is the generation task.

`veo-2.0-generate-001` is retired and remains only as a registry migration record.

### xAI Grok Imagine Video

```typescript
Connector.create({
  name: 'xai',
  vendor: Vendor.Grok,
  auth: { type: 'api_key', apiKey: process.env.XAI_API_KEY! },
});

const grokVideo = VideoGeneration.create({ connector: 'xai' });

// Current text-to-video default.
const textJob = await grokVideo.generate({
  prompt: 'A paper sculpture unfolding into a city skyline',
  model: 'grok-imagine-video',
  duration: 8,
  resolution: '720p',
});

// Grok Imagine Video 1.5 is preferred for higher-fidelity image-to-video.
const imageJob = await grokVideo.generate({
  prompt: 'Slow cinematic push-in with moving clouds',
  model: 'grok-imagine-video-1.5',
  image: './keyframe.png',
  duration: 8,
  resolution: '1080p',
});
```

### Video Extension

Extend an existing video by generating an additional segment after it.
For OpenAI Sora the API references completed clips by **id** (the `jobId`
returned by `generate()` / `generateAndWait()`), not by buffer or URL.

```typescript
const videoGen = VideoGeneration.create({ connector: 'openai' });

// First, create a video
const original = await videoGen.generateAndWait({
  prompt: 'A rocket launching',
  duration: 4,
});

// Extend it (Sora: pass the jobId; the new segment length is `extendDuration`)
const extended = await videoGen.extend({
  model: 'sora-2',
  video: original.jobId,
  prompt: 'The rocket continues into space',
  extendDuration: 8,        // length of the *new* segment, snapped to 4/8/12
  direction: 'end',         // currently advisory; OpenAI extends from the end
});

await videoGen.waitForCompletion(extended.jobId);
```

> **Note** — older versions of this library aliased `extend()` onto the
> `videos.remix()` SDK call, which does not actually lengthen the clip.
> As of the current release, `extend()` is wired to the real
> `videos.extend()` endpoint; if you relied on the old aliasing behaviour,
> use `videoGen.remix()` (below) instead.

### Video Remix and Edit (Sora)

OpenAI Sora exposes two more transforms on completed videos:

```typescript
// Remix — same length, prompt-steered re-generation.
const remix = await videoGen.remix({
  videoId: original.jobId,
  prompt: 'Same composition, but at golden hour',
});

// Edit — apply a prompt-described change to the completed clip.
const edited = await videoGen.edit({
  videoId: original.jobId,
  prompt: 'Add light snowfall throughout',
});

await Promise.all([
  videoGen.waitForCompletion(remix.jobId),
  videoGen.waitForCompletion(edited.jobId),
]);
```

Both methods throw `Video remix not supported by …` / `Video edit not
supported by …` when the underlying provider does not implement them.
Today only the OpenAI Sora provider does.

### Reusable Characters (Sora)

The Sora character API lets you upload a reference video to register a
named character, then thread the returned id back into a future
`generate()` via `vendorOptions.characterId`.

```typescript
// Register the character from a reference clip.
const hero = await videoGen.createCharacter({
  name: 'Hero',
  video: './reference-shot.mp4',  // Buffer | local path | URL
});
// → { id: 'char_…', name: 'Hero' }

// Reuse on subsequent generations.
const scene = await videoGen.generate({
  prompt: 'Hero walks across a windswept beach at dusk',
  vendorOptions: { characterId: hero.id },
});

// Look up later.
const same = await videoGen.getCharacter(hero.id);
```

The character id is stable across generations, so you can keep a single
character coherent across multiple shots.

### Higher-Resolution Sora Output

Sora supports four output sizes. Pass either a `resolution` string or an
`aspectRatio` keyword:

| Resolution | Orientation | Notes |
|---|---|---|
| `720x1280` | Portrait | Default |
| `1280x720` | Landscape | Standard 720p |
| `1024x1792` | Portrait, 1.4× | Higher-resolution export |
| `1792x1024` | Landscape, 1.4× | Higher-resolution export |

```typescript
const hd = await videoGen.generate({
  prompt: 'Aerial shot of a coastline at dawn',
  model: 'sora-2-pro',
  resolution: '1792x1024',
});
```

### Available Models

The video registry contains ten records: the nine callable entries below and
the retired `veo-2.0-generate-001` migration record.

#### OpenAI Sora Models

| Model | Features | Durations | Resolutions | Price/Second |
|-------|----------|-----------|-------------|--------------|
| `sora-2` | Deprecated/callable; text/image-to-video, audio, extension | 4-20s | 720p | $0.10 ($0.05 batch) |
| `sora-2-pro` | Deprecated/callable; higher resolution and frame control | 4-20s | 720p-1080p | $0.30-$0.70 ($0.15-$0.35 batch) |

#### Google Veo Models

| Model | Features | Durations | Resolutions | Price/Second |
|-------|----------|-----------|-------------|--------------|
| `veo-3.1-lite-generate-preview` | Preferred low-cost preview, native audio | 4-8s | 720p-1080p | $0.05-$0.08 |
| `veo-3.1-fast-generate-preview` | Fast inference, audio | 4-8s | 720p-4K | $0.10-$0.30 |
| `veo-3.1-generate-preview` | Full features, 4K | 4-8s | 720p-4K | $0.40 |
| `gemini-omni-1.1-flash` | Active, preferred conversational generation/editing | 3-10s | 360p-4K | ~$0.10 at 720p |
| `gemini-omni-flash-preview` | Deprecated; shuts down 2026-09-30 | 3-10s | 720p | $0.10 |

#### xAI Grok Imagine Models

| Model | Features | Durations | Resolutions | Price/Second |
|-------|----------|-----------|-------------|--------------|
| `grok-imagine-video` | Text/image-to-video with audio | 1-15s | 480p-720p | $0.05-$0.07 |
| `grok-imagine-video-1.5` | Preferred text/image/reference-to-video | 1-15s | 480p-1080p | $0.08-$0.25 plus $0.01 input image |

### Model Introspection

```typescript
// List available models
const models = await videoGen.listModels();
console.log('Available models:', models);

// Get model information
const info = videoGen.getModelInfo('sora-2');
console.log('Durations:', info.capabilities.durations);       // [4, 8, 12, 16, 20]
console.log('Resolutions:', info.capabilities.resolutions);   // ['720x1280', ...]
console.log('Has audio:', info.capabilities.audio);           // true
console.log('Image-to-video:', info.capabilities.imageToVideo); // true
console.log('Style control:', info.capabilities.features.styleControl); // false
console.log('Lifecycle:', info.lifecycle);                      // deprecated
```

### Cost Estimation

```typescript
import { calculateVideoCost } from '@everworker/oneringai';

// Sora 2: $0.10/second
const soraCost = calculateVideoCost('sora-2', 8);  // 8 seconds
console.log(`Sora 2 (8s): $${soraCost}`);  // $0.80

// Sora 2 Pro: $0.30/second
const proCost = calculateVideoCost('sora-2-pro', 12);  // 12 seconds
console.log(`Sora 2 Pro (12s): $${proCost}`);  // $3.60

// Veo 3.1 Lite at 1080p: $0.08/second
const veoCost = calculateVideoCost('veo-3.1-lite-generate-preview', 8, {
  resolution: '1080p',
});
console.log(`Veo 3.1 Lite (8s, 1080p): $${veoCost}`); // $0.64

// Grok 1.5 at 1080p plus one image input.
const grokCost = calculateVideoCost('grok-imagine-video-1.5', 8, {
  resolution: '1080p',
  inputImages: 1,
});
console.log(`Grok Imagine 1.5 (8s, 1080p): $${grokCost}`); // $2.01
```

### Error Handling

```typescript
try {
  const job = await videoGen.generate({
    prompt: 'A video',
    duration: 8,
  });

  const result = await videoGen.waitForCompletion(job.jobId, 300000); // 5 min timeout

  if (result.status === 'completed') {
    const buffer = await videoGen.download(result.jobId);
    await fs.writeFile('./output.mp4', buffer);
  }
} catch (error) {
  if (error.message.includes('timed out')) {
    console.error('Video generation took too long');
  } else if (error.message.includes('failed')) {
    console.error('Video generation failed:', error.message);
  } else if (error.message.includes('policy')) {
    console.error('Content policy violation');
  } else {
    console.error('Error:', error.message);
  }
}
```

### Job Management

```typescript
// Cancel a pending job
const job = await videoGen.generate({ prompt: '...', duration: 8 });

// Changed your mind? Cancel it
const cancelled = await videoGen.cancel(job.jobId);
console.log('Cancelled:', cancelled);  // true
```

---

## Custom Media Storage

By default, multimedia tools (image generation, video generation, TTS, STT) save outputs to the local filesystem via `FileMediaStorage`. You can plug in custom storage backends (S3, GCS, Azure Blob, etc.) by implementing the `IMediaStorage` interface.

### The IMediaStorage Interface

```typescript
import type { IMediaStorage, MediaStorageMetadata, MediaStorageResult } from '@everworker/oneringai';

interface IMediaStorage {
  save(data: Buffer, metadata: MediaStorageMetadata): Promise<MediaStorageResult>;
  read(location: string): Promise<Buffer | null>;
  delete(location: string): Promise<void>;
  exists(location: string): Promise<boolean>;
  list?(options?: MediaStorageListOptions): Promise<MediaStorageEntry[]>;  // optional
  getPath(): string;
}
```

**`MediaStorageMetadata`** describes the media being saved:
- `type`: `'image' | 'video' | 'audio'`
- `format`: file extension (e.g., `'png'`, `'mp4'`, `'mp3'`)
- `model`: model name used for generation
- `vendor`: vendor that produced the output
- `index?`: index for multi-image results
- `suggestedFilename?`: optional filename hint

**`MediaStorageResult`** returned by `save()`:
- `location`: where the file was stored (path, URL, S3 key, etc.)
- `mimeType`: MIME type of the saved file
- `size`: file size in bytes

### Custom S3 Backend Example

```typescript
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { IMediaStorage, MediaStorageMetadata, MediaStorageResult } from '@everworker/oneringai';

class S3MediaStorage implements IMediaStorage {
  private s3: S3Client;
  private bucket: string;

  constructor(bucket: string, region: string) {
    this.s3 = new S3Client({ region });
    this.bucket = bucket;
  }

  async save(data: Buffer, metadata: MediaStorageMetadata): Promise<MediaStorageResult> {
    const key = `media/${metadata.type}/${Date.now()}_${Math.random().toString(36).slice(2)}.${metadata.format}`;
    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: this.getMimeType(metadata.format),
    }));
    return { location: key, mimeType: this.getMimeType(metadata.format), size: data.length };
  }

  async read(location: string): Promise<Buffer | null> {
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: location }));
      return Buffer.from(await response.Body!.transformToByteArray());
    } catch (err: any) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async delete(location: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: location }));
  }

  async exists(location: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: location }));
      return true;
    } catch { return false; }
  }

  getPath(): string { return `s3://${this.bucket}/media/`; }

  private getMimeType(format: string): string {
    const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', mp4: 'video/mp4', mp3: 'audio/mpeg' };
    return map[format] ?? 'application/octet-stream';
  }
}
```

### Setting the Global Storage

```typescript
import { setMediaStorage } from '@everworker/oneringai';

// Set globally before creating agents - all multimedia tools will use this
setMediaStorage(new S3MediaStorage('my-bucket', 'us-east-1'));
```

All multimedia tools (`generate_image`, `generate_video`, `text_to_speech`, `speech_to_text`) automatically use the global storage handler.

### FileMediaStorage Default

The built-in `FileMediaStorage` saves files to `os.tmpdir()/oneringai-media/` by default:

```typescript
import { FileMediaStorage, createFileMediaStorage } from '@everworker/oneringai';

// Use defaults (saves to /tmp/oneringai-media/)
const storage = createFileMediaStorage();

// Custom output directory
const storage = createFileMediaStorage({ outputDir: '/data/media-outputs' });
```

### Per-Tool-Factory Storage

For advanced use cases, you can pass a storage instance directly to individual tool factories:

```typescript
import { createImageGenerationTool } from '@everworker/oneringai';

const connector = Connector.get('openai');
const tool = createImageGenerationTool(connector, myCustomStorage);
```

---

## Web Search

Web search capabilities with Connector-based authentication. Supports multiple providers: Serper, Brave, Tavily, and RapidAPI.

### Quick Start

```typescript
import { Connector, SearchProvider, Services } from '@everworker/oneringai';

// Create search connector
Connector.create({
  name: 'serper-main',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

// Create search provider
const search = SearchProvider.create({ connector: 'serper-main' });

// Perform search
const results = await search.search('latest AI developments 2026', {
  numResults: 10,
  country: 'us',
  language: 'en',
});

if (results.success) {
  console.log(`Found ${results.count} results:`);
  results.results.forEach((result, i) => {
    console.log(`${i + 1}. ${result.title}`);
    console.log(`   ${result.url}`);
    console.log(`   ${result.snippet}\n`);
  });
}
```

### Search Providers

#### Serper (Google Search)

Fast Google search results via Serper.dev API:

```typescript
Connector.create({
  name: 'serper-main',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

const search = SearchProvider.create({ connector: 'serper-main' });
const results = await search.search('query', {
  numResults: 10,
  country: 'us',
  language: 'en',
});
```

**Features:**
- Fast (1-2 second response time)
- 2,500 free queries, then $0.30/1k
- Google search quality
- Up to 100 results per query

#### Brave Search

Independent search index (privacy-focused):

```typescript
Connector.create({
  name: 'brave-main',
  serviceType: Services.BraveSearch,
  auth: { type: 'api_key', apiKey: process.env.BRAVE_API_KEY! },
  baseURL: 'https://api.search.brave.com/res/v1',
});

const search = SearchProvider.create({ connector: 'brave-main' });
const results = await search.search('query', {
  numResults: 10,
});
```

**Features:**
- Privacy-focused (no Google)
- Independent search index
- 2,000 free queries, then $3/1k
- Up to 20 results per query

#### Tavily

AI-optimized search with summaries:

```typescript
Connector.create({
  name: 'tavily-main',
  serviceType: Services.Tavily,
  auth: { type: 'api_key', apiKey: process.env.TAVILY_API_KEY! },
  baseURL: 'https://api.tavily.com',
});

const search = SearchProvider.create({ connector: 'tavily-main' });
const results = await search.search('query', {
  numResults: 10,
  vendorOptions: {
    search_depth: 'advanced',  // 'basic' or 'advanced'
    include_answer: true,
    include_raw_content: false,
  },
});
```

**Features:**
- AI-optimized for LLMs
- Includes summaries
- 1,000 free queries, then $1/1k
- Up to 20 results per query

#### RapidAPI

Real-time web search via RapidAPI:

```typescript
Connector.create({
  name: 'rapidapi-search',
  serviceType: Services.RapidapiSearch,
  auth: { type: 'api_key', apiKey: process.env.RAPIDAPI_KEY! },
  baseURL: 'https://real-time-web-search.p.rapidapi.com',
});

const search = SearchProvider.create({ connector: 'rapidapi-search' });
const results = await search.search('query', {
  numResults: 50,
  country: 'us',
  language: 'en',
  vendorOptions: {
    start: 0,                  // Pagination offset
    fetch_ai_overviews: false,
    deduplicate: false,
    nfpr: 0,                   // No auto-correct
    tbs: 'qdr:d',             // Time-based search (d=day, w=week, m=month, y=year)
    location: 'New York',      // Search origin
  },
});
```

**Features:**
- Real-time web results
- Up to 100 results per query
- Advanced filtering options
- Various pricing plans

### Using with Agent (ConnectorTools)

Search tools are registered via ConnectorTools. Create a connector, then get the tools:

```typescript
import { Agent, Connector, ConnectorTools, tools } from '@everworker/oneringai';

// Create a search connector
Connector.create({
  name: 'serper',
  serviceType: 'serper',
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

// Get search tools from the connector
const searchTools = ConnectorTools.for('serper');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tools.webFetch, ...searchTools],
});

const response = await agent.run(
  'Search for the latest AI news from 2026 and summarize the top 3 results'
);
```

**Tool Parameters:**
- `query` (required) - Search query string
- `numResults` - Number of results (default: 10, max: 100)
- `country` - Country/region code (e.g., 'us', 'gb')
- `language` - Language code (e.g., 'en', 'fr')

**Note:** Tools are prefixed with the connector name (e.g., `serper_web_search`).

### Multiple Keys (Failover)

Support for backup keys:

```typescript
// Main connector
Connector.create({
  name: 'serper-main',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY_MAIN! },
  baseURL: 'https://google.serper.dev',
});

// Backup connector
Connector.create({
  name: 'serper-backup',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY_BACKUP! },
  baseURL: 'https://google.serper.dev',
});

// Use with failover
try {
  const search = SearchProvider.create({ connector: 'serper-main' });
  const results = await search.search('query');
} catch (error) {
  console.log('Main failed, trying backup...');
  const backup = SearchProvider.create({ connector: 'serper-backup' });
  const results = await backup.search('query');
}
```

### Enterprise Resilience

All Connector features automatically apply:

```typescript
Connector.create({
  name: 'serper-main',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',

  // Resilience features
  timeout: 30000,  // 30 second timeout
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatuses: [429, 500, 502, 503, 504],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeoutMs: 60000,
  },
});

const search = SearchProvider.create({ connector: 'serper-main' });
// Automatically includes retry, circuit breaker, and timeout!
const results = await search.search('query');
```

### Metrics and Monitoring

```typescript
const connector = Connector.get('serper-main');

// Get metrics
const metrics = connector.getMetrics();
console.log(`Requests: ${metrics.requestCount}`);
console.log(`Success rate: ${((metrics.successCount / metrics.requestCount) * 100).toFixed(1)}%`);
console.log(`Avg latency: ${metrics.avgLatencyMs.toFixed(0)}ms`);

// Circuit breaker state
const cbState = metrics.circuitBreakerState;
console.log(`Circuit breaker: ${cbState}`);  // 'closed' | 'open' | 'half-open'
```

### Best Practices

1. **Use Connectors** - Preferred over environment variables
2. **Setup Backup Keys** - For production resilience
3. **Monitor Metrics** - Track usage and performance
4. **Cache Results** - Reduce API costs by caching
5. **Handle Errors** - Always check `results.success`
6. **Respect Rate Limits** - Each provider has different limits

### Error Handling

```typescript
const results = await search.search('query');

if (!results.success) {
  console.error('Search failed:', results.error);

  // Check error type
  if (results.error?.includes('API key')) {
    console.error('Authentication failed - check API key');
  } else if (results.error?.includes('429')) {
    console.error('Rate limit exceeded - try backup connector');
  } else if (results.error?.includes('timeout')) {
    console.error('Request timed out - increase timeout setting');
  }
} else {
  console.log(`Success: ${results.count} results`);
}
```

---

## Web Scraping

The library provides enterprise web scraping with automatic fallback chains and bot protection bypass.

### Quick Start

```typescript
import { Connector, ScrapeProvider, Services } from '@everworker/oneringai';

// Create ZenRows connector
Connector.create({
  name: 'zenrows',
  serviceType: Services.Zenrows,
  auth: { type: 'api_key', apiKey: process.env.ZENROWS_API_KEY! },
  baseURL: 'https://api.zenrows.com/v1',
});

// Create scrape provider
const scraper = ScrapeProvider.create({ connector: 'zenrows' });

// Scrape a URL
const result = await scraper.scrape('https://example.com', {
  includeMarkdown: true,
  includeLinks: true,
});

if (result.success) {
  console.log(result.result?.title);
  console.log(result.result?.content);
  console.log(result.finalUrl);
}
```

### ZenRows Provider

ZenRows provides enterprise-grade scraping with:
- JavaScript rendering for SPAs
- Premium proxies (residential IPs)
- Anti-bot and CAPTCHA bypass
- Markdown conversion
- Screenshot capture

```typescript
import { ScrapeProvider } from '@everworker/oneringai';

const scraper = ScrapeProvider.create({ connector: 'zenrows' });

// Full control with ZenRows options
const result = await scraper.scrape('https://protected-site.com', {
  includeMarkdown: true,
  includeScreenshot: true,
  vendorOptions: {
    jsRender: true,           // Enable JS rendering (default: true)
    premiumProxy: true,       // Use residential IPs (default: true)
    wait: 5000,               // Wait 5s before scraping
    waitFor: '.content',      // Wait for CSS selector
    device: 'mobile',         // Mobile user agent
    proxyCountry: 'us',       // Use US proxies
    autoparse: true,          // Auto-structure data
  },
});
```

### Using web_scrape Tool with Agent (ConnectorTools)

The web_scrape tool is available via ConnectorTools. It tries native fetch first, then falls back to the bound scrape provider:

```typescript
import { Agent, Connector, ConnectorTools, tools } from '@everworker/oneringai';

// Create scrape connector
Connector.create({
  name: 'zenrows',
  serviceType: 'zenrows',
  auth: { type: 'api_key', apiKey: process.env.ZENROWS_API_KEY! },
  baseURL: 'https://api.zenrows.com/v1',
});

const scrapeTools = ConnectorTools.for('zenrows');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [tools.webFetch, ...scrapeTools],
});

// Agent uses automatic fallback: native → API
await agent.run('Scrape https://example.com and summarize');
```

### Tool Parameters

The `web_scrape` tool accepts:
- `url` (required) — URL to scrape
- `timeout` — Timeout in milliseconds (default: 30000)
- `includeHtml` — Include raw HTML (default: false)
- `includeMarkdown` — Convert to markdown (recommended for LLMs)
- `includeLinks` — Extract links
- `waitForSelector` — Wait for CSS selector (for JS-heavy sites)

**Note:** The tool automatically detects available scrape connectors by serviceType.
Scraping strategy is handled internally - the tool will use the best available method.

### Best Practices

1. **Configure a connector** - Set up ZenRows or similar for protected sites
2. **Request markdown** - Cleaner output for LLM processing
3. **Handle errors** - Check `result.success` and `result.error`
4. **Use waitForSelector** - For JavaScript-heavy sites that need time to render

---

## Streaming

### Basic Streaming

```typescript
import { Agent, isOutputTextDelta } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
});

// Stream response
for await (const event of agent.stream('Tell me a story')) {
  if (isOutputTextDelta(event)) {
    process.stdout.write(event.delta);
  }
}
```

### Stream Helpers

```typescript
import { StreamHelpers } from '@everworker/oneringai';

// Text only (filters to just text deltas)
for await (const text of StreamHelpers.textOnly(agent.stream('Hello'))) {
  process.stdout.write(text);
}

// All events
for await (const event of agent.stream('Hello')) {
  switch (event.type) {
    case 'response.created':
      console.log('🔄 Starting...');
      break;

    case 'response.output_text.delta':
      process.stdout.write(event.delta);
      break;

    case 'response.tool_call.start':
      console.log(`\n🔧 Calling ${event.tool_name}...`);
      break;

    case 'response.tool_execution.done':
      console.log(`✅ Tool complete`);
      break;

    case 'response.complete':
      console.log('\n✓ Done');
      break;

    case 'response.error':
      console.error('Error:', event.error);
      break;
  }
}
```

### Streaming with Tools

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool, calculatorTool],
});

for await (const event of agent.stream('What is the weather in Paris?')) {
  if (event.type === 'response.tool_call.start') {
    console.log(`🔧 Calling ${event.tool_name}...`);
  }

  if (event.type === 'response.tool_execution.done') {
    console.log(`✅ Tool result: ${JSON.stringify(event.result)}`);
  }

  if (event.type === 'response.output_text.delta') {
    process.stdout.write(event.delta);
  }
}
```

---

## External API Integration

Connect your AI agents to 50 external services with enterprise-grade resilience. The library provides both connector-based tools and direct fetch capabilities.

> **Need the inventory rather than a tutorial?** The
> [Connector & Tool Catalog](./docs/CONNECTOR_TOOL_CATALOG.md) lists every
> template, the generic tool each connector receives, all specialized packs,
> connector-free built-ins, plugin tools, and the runtime discovery APIs.

### Overview

External API integration uses the **Connector-First Architecture** - the same pattern used for AI providers. This means:
- Single source of truth for authentication
- Built-in resilience (retry, timeout, circuit breaker)
- Automatic tool generation for any service

### Quick Start

```typescript
import { Connector, ConnectorTools, Services, Agent } from '@everworker/oneringai';

// 1. Create a connector for an external service
Connector.create({
  name: 'github',
  serviceType: Services.Github,
  auth: { type: 'api_key', apiKey: process.env.GITHUB_TOKEN! },
  baseURL: 'https://api.github.com',
});

// 2. Generate tools from the connector
const tools = ConnectorTools.for('github');

// 3. Use with an agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: tools,
});

// 4. Agent can now call the GitHub API
await agent.run('List all open issues in owner/repo');
```

### Connector Configuration

#### Basic Configuration

```typescript
Connector.create({
  name: 'slack',
  serviceType: Services.Slack,  // Optional: explicit service type
  auth: { type: 'api_key', apiKey: process.env.SLACK_TOKEN! },
  baseURL: 'https://slack.com/api',
});
```

#### Enterprise Resilience Features

```typescript
Connector.create({
  name: 'stripe',
  serviceType: Services.Stripe,
  auth: { type: 'api_key', apiKey: process.env.STRIPE_SECRET_KEY! },
  baseURL: 'https://api.stripe.com/v1',

  // Timeout
  timeout: 30000,  // 30 seconds (default)

  // Retry with exponential backoff
  retry: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatuses: [429, 500, 502, 503, 504],
  },

  // Circuit breaker
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,      // Open after 5 failures
    successThreshold: 2,      // Close after 2 successes
    resetTimeoutMs: 60000,    // Try again after 60s
  },

  // Logging
  logging: {
    enabled: true,
    logBody: false,           // Don't log request/response bodies
    logHeaders: false,        // Don't log headers
  },
});
```

### Supported Services (50)

The library includes built-in definitions for 50 popular services:

| Category | Services |
|----------|----------|
| **Major Vendors** | Microsoft, Google |
| **Communication** | Slack, Discord, Telegram, X (Twitter), Zoom, HeyReach |
| **Development** | GitHub, GitLab, Bitbucket, Jira, Linear, Asana, Trello |
| **Productivity** | Notion, Airtable, Confluence, Cal.com, Calendly |
| **CRM** | Salesforce, HubSpot, Pipedrive |
| **Payments** | Stripe, PayPal, QuickBooks, Ramp |
| **Cloud** | AWS, Cloudflare |
| **Storage** | Dropbox, Box |
| **Email** | SendGrid, Mailchimp, Postmark, Mailgun, EmailBison |
| **Monitoring** | Datadog, PagerDuty, Sentry |
| **Search** | Serper, Brave Search, Tavily, RapidAPI Search |
| **Scrape** | ZenRows |
| **Other** | Twilio, Zendesk, Intercom, Shopify, ipinfo, Clay |

```typescript
import { Services, getServiceInfo, getServicesByCategory } from '@everworker/oneringai';

// Use service constants
Connector.create({
  name: 'my-slack',
  serviceType: Services.Slack,  // Type-safe
  // ...
});

// Get service metadata
const info = getServiceInfo('slack');
console.log(info?.name);        // 'Slack'
console.log(info?.category);    // 'communication'
console.log(info?.docsURL);     // 'https://api.slack.com/methods'
console.log(info?.commonScopes); // ['chat:write', 'channels:read', ...]

// Filter by category
const devServices = getServicesByCategory('development');
// Returns: github, gitlab, jira, linear, bitbucket, ...
```

### Using Connector.fetch()

For direct API calls without tools:

```typescript
const connector = Connector.get('github');

// Basic fetch
const response = await connector.fetch('/repos/owner/repo/issues', {
  method: 'GET',
  queryParams: { state: 'open', per_page: '10' },
});

// JSON helper with automatic parsing
const issues = await connector.fetchJSON<Issue[]>('/repos/owner/repo/issues');

// POST with body
const newIssue = await connector.fetchJSON('/repos/owner/repo/issues', {
  method: 'POST',
  body: {
    title: 'New Issue',
    body: 'Issue description',
    labels: ['bug'],
  },
});

// Per-request options
const urgent = await connector.fetch('/chat.postMessage', {
  method: 'POST',
  body: { channel: 'C123', text: 'Urgent!' },
  timeout: 5000,           // Override timeout
  skipRetry: true,         // Skip retry for this request
  skipCircuitBreaker: true, // Bypass circuit breaker
});
```

### ConnectorTools API

#### Generate Tools for a Connector

```typescript
import { ConnectorTools } from '@everworker/oneringai';

// Get all tools for a connector (generic API + any registered service tools)
const tools = ConnectorTools.for('github');
const tools = ConnectorTools.for(connector);  // Can pass instance too

// userId is automatic — all generated tools read it from ToolContext at execution time.
// No need to pass userId to ConnectorTools.for().
// Just set it on the agent: Agent.create({ userId: 'user-123', tools })

// With scoped registry (access control)
const registry = Connector.scoped({ tenantId: 'acme' });
const tools = ConnectorTools.for('github', undefined, { registry });

// The generic API tool is included automatically by ConnectorTools.for()
// (named `{connectorName}_api` whenever the connector has a baseURL)
const tools = ConnectorTools.for('github');
const apiTool = tools.find(t => t.definition.function.name === 'github_api');
```

#### Tool Naming Convention

All tools generated by `ConnectorTools.for()` are prefixed with the connector name to prevent naming collisions when multiple connectors provide tools with the same base name:

| Tool type | Naming pattern | Example |
|-----------|---------------|---------|
| Generic API | `{connectorName}_api` | `github_api`, `slack_api` |
| Service-specific | `{connectorName}_{toolName}` | `github_search_files`, `google_generate_image`, `main-openai_text_to_speech` |

**Services with built-in tools:**
- **GitHub** — 8 tools: `search_files`, `search_code`, `read_file`, `list_branches`, `get_pr`, `pr_files`, `pr_comments`, `create_pr` (see [GitHub Connector Tools](#github-connector-tools))
- **Microsoft** — 11 tools: email, calendar, meetings, Teams transcripts, OneDrive/SharePoint files (see [Microsoft Graph Connector Tools](#microsoft-graph-connector-tools))
- **Google Workspace** — 11 tools: Gmail, Calendar, Meet transcripts, Drive files (see [Google Workspace Connector Tools](#google-workspace-connector-tools))
- **Zoom** — 3 tools: `zoom_create_meeting`, `zoom_update_meeting`, `zoom_get_transcript` (see [Zoom Connector Tools](#zoom-connector-tools))
- **Telegram** — 6 tools: `telegram_send_message`, `telegram_send_photo`, `telegram_get_updates`, `telegram_set_webhook`, `telegram_get_me`, `telegram_get_chat` (see [Telegram Connector Tools](#telegram-connector-tools))
- **Twilio** — 4 tools: `send_sms`, `send_whatsapp`, `list_messages`, `get_message` (see [Twilio Connector Tools](#twilio-connector-tools))
- **AI Vendors** (OpenAI, Google, Grok) — Multimedia tools: `generate_image`, `generate_video`, `text_to_speech`, `speech_to_text`

This ensures that tools from different vendors (e.g., `google_generate_image` vs `main-openai_generate_image`) never collide, and are clearly identified by connector in UIs and agent configs.

`ToolRegistry` automatically derives clean display names from these prefixed names using vendor metadata (e.g., `google_generate_image` displays as "Google Generate Image").

#### The Generic API Tool

Every connector with a `baseURL` gets a generic API tool that allows the agent to make any API call:

```jsonc
// Tool schema:
{
  name: 'github_api',  // {connectorName}_api
  description: 'Make API requests to api.github.com',
  parameters: {
    method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    endpoint: { type: 'string' },          // API path, e.g., '/repos/owner/repo'
    body: { type: 'object' },              // JSON request body (POST/PUT/PATCH)
    queryParams: { type: 'object' },       // URL query parameters (GET filtering/pagination)
    headers: { type: 'object' },           // Additional headers (auth headers are protected)
  }
}
```

**Important:** For `POST`/`PUT`/`PATCH` requests, data must be passed in the `body` parameter as a JSON object — **not** as query string parameters in the endpoint URL. The body is sent as `application/json`. For example, to post a Slack message:

```jsonc
// Correct: data in body
{ method: 'POST', endpoint: '/chat.postMessage', body: { channel: 'C123', text: 'Hello!' } }

// Wrong: data in query string — many APIs will reject this
{ method: 'POST', endpoint: '/chat.postMessage?channel=C123&text=Hello!' }
```

**Security:** Authorization headers cannot be overridden by the agent.

#### Register Custom Service Tools

For frequently-used operations, register service-specific tools. Note that tool names returned by the factory use generic names — `ConnectorTools.for()` automatically prefixes them with the connector name:

```typescript
import { ConnectorTools, ToolFunction } from '@everworker/oneringai';

// Register tools for a service type
ConnectorTools.registerService('slack', (connector) => {
  const listChannels: ToolFunction = {
    definition: {
      type: 'function',
      function: {
        name: 'list_channels',
        description: 'List all Slack channels',
        parameters: {
          type: 'object',
          properties: {
            types: {
              type: 'string',
              description: 'Filter by channel types',
              enum: ['public_channel', 'private_channel'],
            },
            limit: { type: 'number', description: 'Max results' },
          },
        },
      },
    },
    execute: async (args) => {
      return connector.fetchJSON('/conversations.list', {
        queryParams: { types: args.types, limit: String(args.limit || 100) },
      });
    },
    describeCall: (args) => `List ${args.types || 'all'} channels`,
  };

  const postMessage: ToolFunction = {
    definition: {
      type: 'function',
      function: {
        name: 'post_message',
        description: 'Post a message to a Slack channel',
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel ID' },
            text: { type: 'string', description: 'Message text' },
          },
          required: ['channel', 'text'],
        },
      },
    },
    execute: async (args) => {
      return connector.fetchJSON('/chat.postMessage', {
        method: 'POST',
        body: { channel: args.channel, text: args.text },
      });
    },
    describeCall: (args) => `Post to ${args.channel}`,
    permission: { riskLevel: 'medium', scope: 'session' },
  };

  return [listChannels, postMessage];
});

// Now ConnectorTools.for('slack-connector') returns:
// slack-connector_api, slack-connector_list_channels, slack-connector_post_message
```

#### Discover All Connectors

```typescript
// Get tools for all connectors with serviceType
const allTools = ConnectorTools.discoverAll();
// Returns: Map<connectorName, ToolFunction[]>

for (const [name, tools] of allTools) {
  console.log(`${name}: ${tools.length} tools`);
}

// Find connector by service type
const slackConnector = ConnectorTools.findConnector(Services.Slack);

// Find all connectors for a service type
const allSlackConnectors = ConnectorTools.findConnectors(Services.Slack);

// Check if service has custom tools
if (ConnectorTools.hasServiceTools('slack')) {
  // ...
}

// List all services with custom tools registered
const services = ConnectorTools.listSupportedServices();
```

### ToolRegistry API

Unified view of all tools (built-in + connector-generated). Use this for UI tool pickers, inventory screens, or any code that needs to enumerate available tools.

#### Basic Usage

```typescript
import { ToolRegistry } from '@everworker/oneringai';

// Get ALL tools (main API for UIs)
const allTools = ToolRegistry.getAllTools();

// Built-in tools only (filesystem, shell, web, code, json, connector, desktop, custom-tools, routines, other)
const builtInTools = ToolRegistry.getBuiltInTools();

// All connector-generated tools
const connectorTools = ToolRegistry.getAllConnectorTools();

// Tools for a specific connector
const githubTools = ToolRegistry.getConnectorTools('github');

// Filter by service type
const slackTools = ToolRegistry.getToolsByService('slack');

// Filter by connector name
const myApiTools = ToolRegistry.getToolsByConnector('my-api');
```

#### Type Guard

Use `isConnectorTool()` to distinguish built-in from connector tools:

```typescript
for (const tool of ToolRegistry.getAllTools()) {
  if (ToolRegistry.isConnectorTool(tool)) {
    // ConnectorToolEntry - has connectorName, serviceType
    console.log(`API: ${tool.displayName} (${tool.connectorName})`);
  } else {
    // ToolRegistryEntry - built-in tool
    console.log(`Built-in: ${tool.displayName}`);
  }
}
```

#### Methods Reference

| Method | Returns | Description |
|--------|---------|-------------|
| `getAllTools()` | `(ToolRegistryEntry \| ConnectorToolEntry)[]` | All tools (main API) |
| `getBuiltInTools()` | `ToolRegistryEntry[]` | Built-in tools only |
| `getAllConnectorTools()` | `ConnectorToolEntry[]` | All connector tools |
| `getConnectorTools(name)` | `ConnectorToolEntry[]` | Tools for specific connector |
| `getToolsByService(type)` | `ConnectorToolEntry[]` | Filter by service type |
| `getToolsByConnector(name)` | `ConnectorToolEntry[]` | Filter by connector name |
| `isConnectorTool(entry)` | `boolean` | Type guard for ConnectorToolEntry |

#### Entry Properties

**ToolRegistryEntry** (built-in tools):

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Tool name (e.g., `read_file`) |
| `displayName` | `string` | Human-readable name (e.g., `Read File`) |
| `category` | `ToolCategory` | `filesystem`, `shell`, `web`, `code`, `json`, `connector`, `desktop`, `custom-tools`, `routines`, `other` |
| `description` | `string` | Brief description |
| `safeByDefault` | `boolean` | Whether safe without approval |
| `tool` | `ToolFunction` | The actual tool function |
| `requiresConnector` | `boolean?` | If tool needs a connector |
| `connectorServiceTypes` | `string[]?` | Supported service types |

**ConnectorToolEntry** extends ToolRegistryEntry with:

| Property | Type | Description |
|----------|------|-------------|
| `connectorName` | `string` | Source connector name |
| `serviceType` | `string?` | Detected service type (e.g., `github`) |

### Service Detection

Services are detected from URL patterns or explicit `serviceType`:

```typescript
import { detectServiceFromURL, Services } from '@everworker/oneringai';

// Automatic detection from URL
detectServiceFromURL('https://api.github.com/repos');     // 'github'
detectServiceFromURL('https://slack.com/api/chat');       // 'slack'
detectServiceFromURL('https://api.stripe.com/v1');        // 'stripe'
detectServiceFromURL('https://company.atlassian.net/jira'); // 'jira'

// Explicit serviceType takes precedence
Connector.create({
  name: 'custom',
  serviceType: Services.Jira,                        // Explicit
  baseURL: 'https://api.github.com',                 // Ignored for detection
});
```

### Metrics and Monitoring

```typescript
const connector = Connector.get('github');

// Get metrics
const metrics = connector.getMetrics();
console.log(`Requests: ${metrics.requestCount}`);
console.log(`Success: ${metrics.successCount}`);
console.log(`Failures: ${metrics.failureCount}`);
console.log(`Avg Latency: ${metrics.avgLatencyMs}ms`);
console.log(`Circuit: ${metrics.circuitBreakerState}`);

// Reset circuit breaker manually
connector.resetCircuitBreaker();

// Check if connector is disposed
if (connector.isDisposed()) {
  // Recreate connector
}
```

### Complete Example

```typescript
import { Connector, ConnectorTools, Services, Agent, Vendor } from '@everworker/oneringai';

// Setup AI connector
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Setup GitHub connector with resilience
Connector.create({
  name: 'github',
  serviceType: Services.Github,
  auth: { type: 'api_key', apiKey: process.env.GITHUB_TOKEN! },
  baseURL: 'https://api.github.com',
  timeout: 15000,
  retry: { maxRetries: 2, baseDelayMs: 500 },
  circuitBreaker: { enabled: true, failureThreshold: 3 },
});

// Setup Slack connector
Connector.create({
  name: 'slack',
  serviceType: Services.Slack,
  auth: { type: 'api_key', apiKey: process.env.SLACK_TOKEN! },
  baseURL: 'https://slack.com/api',
});

// Create agent with external API tools
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [
    ...ConnectorTools.for('github'),
    ...ConnectorTools.for('slack'),
  ],
});

// Agent can now interact with both services
await agent.run(`
  Check if there are any critical issues in owner/repo,
  and if so, post a summary to the #alerts Slack channel.
`);
```

---

## Vendor Templates

Quickly set up connectors for 50 services with pre-configured authentication templates. No need to look up URLs, headers, or scopes - just provide your credentials!

### Quick Start

```typescript
import {
  createConnectorFromTemplate,
  listVendors,
  getVendorTemplate,
  ConnectorTools
} from '@everworker/oneringai';

// Create GitHub connector with Personal Access Token
const connector = createConnectorFromTemplate(
  'my-github',           // Connector name
  'github',              // Vendor ID
  'pat',                 // Auth method
  { apiKey: process.env.GITHUB_TOKEN! }
);

// Get tools for the connector
const tools = ConnectorTools.for('my-github');

// Use with agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools,
});

await agent.run('List my GitHub repositories');
```

### Discovering Available Vendors

```typescript
import { listVendors, getVendorTemplate, getVendorInfo } from '@everworker/oneringai';

// List all available vendors
const vendors = listVendors();
console.log(vendors.length);  // 50

// Get specific vendor info
const github = getVendorInfo('github');
console.log(github);
// {
//   id: 'github',
//   name: 'GitHub',
//   category: 'development',
//   docsURL: 'https://docs.github.com/en/rest',
//   credentialsSetupURL: 'https://github.com/settings/developers',
//   authMethods: [
//     { id: 'pat', name: 'Personal Access Token', type: 'api_key', ... },
//     { id: 'oauth-user', name: 'OAuth App (User Authorization)', type: 'oauth', ... },
//     { id: 'github-app', name: 'GitHub App (Installation Token)', type: 'oauth', ... }
//   ]
// }

// Filter by category
import { listVendorsByCategory, listVendorsByAuthType } from '@everworker/oneringai';

const devVendors = listVendorsByCategory('development');
// [github, gitlab, bitbucket, jira, linear, asana, trello]

const apiKeyVendors = listVendorsByAuthType('api_key');
// All vendors that support API key authentication
```

### Vendor Logos

Access vendor logos for use in UIs. Logos come from the Simple Icons library where available, with branded placeholders for others:

```typescript
import {
  getVendorLogo,
  getVendorLogoSvg,
  getVendorColor,
  hasVendorLogo,
  listVendorsWithLogos,
  getAllVendorLogos
} from '@everworker/oneringai';

// Check if logo is available
if (hasVendorLogo('github')) {
  const logo = getVendorLogo('github');
  console.log(logo.svg);           // Full SVG content
  console.log(logo.hex);           // Brand color: "181717"
  console.log(logo.isPlaceholder); // false (has official icon)
}

// Get just the SVG content
const svg = getVendorLogoSvg('slack');

// Get SVG with custom color
const whiteSvg = getVendorLogoSvg('github', 'FFFFFF');

// Get brand color
const stripeColor = getVendorColor('stripe');  // "635BFF"

// List all vendors with logos
const vendorsWithLogos = listVendorsWithLogos();  // 54 known logo IDs

// Get all logos at once
const allLogos = getAllVendorLogos();  // Map<vendorId, VendorLogo>
```

**VendorLogo Interface:**
```typescript
interface VendorLogo {
  vendorId: string;          // e.g., 'github'
  svg: string;               // Full SVG content
  hex: string;               // Brand color (without #)
  isPlaceholder: boolean;    // true if using generated placeholder
  simpleIconsSlug?: string;  // Simple Icons slug if available
}
```

### Authentication Methods

Each vendor template includes one or more authentication methods:

#### API Key

Simple token-based authentication:

```typescript
// GitHub Personal Access Token
createConnectorFromTemplate('my-github', 'github', 'pat', {
  apiKey: process.env.GITHUB_TOKEN!
});

// Slack Bot Token
createConnectorFromTemplate('my-slack', 'slack', 'bot-token', {
  apiKey: process.env.SLACK_BOT_TOKEN!
});

// Stripe Secret Key
createConnectorFromTemplate('my-stripe', 'stripe', 'api-key', {
  apiKey: process.env.STRIPE_SECRET_KEY!
});

// HeyReach (LinkedIn sequencing) — key sent via the X-API-KEY header
createConnectorFromTemplate('my-heyreach', 'heyreach', 'api-key', {
  apiKey: process.env.HEYREACH_API_KEY!
});

// EmailBison (cold-email sequencing) — per-instance deployment, so you MUST
// override baseURL with your own instance domain.
createConnectorFromTemplate('my-emailbison', 'emailbison', 'api-token', {
  apiKey: process.env.EMAILBISON_TOKEN!
}, { baseURL: 'https://acme.emailbison.com/api' });

// Cal.com — API v1 key passed automatically as the ?apiKey query parameter
createConnectorFromTemplate('my-calcom', 'cal-com', 'api-key', {
  apiKey: process.env.CALCOM_API_KEY!  // cal_live_...
});

// Calendly — Personal Access Token (Bearer). See OAuth section for multi-account.
createConnectorFromTemplate('my-calendly', 'calendly', 'personal-token', {
  apiKey: process.env.CALENDLY_TOKEN!
});
```

#### OAuth (User Authorization)

For apps where users grant permissions:

```typescript
// GitHub OAuth App
createConnectorFromTemplate('my-github-oauth', 'github', 'oauth-user', {
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/callback',
  scope: 'repo read:user'  // Optional - uses template defaults
});

// Google OAuth (unified template also covers Workspace: Drive, Gmail, Calendar, Sheets, Docs)
createConnectorFromTemplate('my-google', 'google-api', 'oauth-user', {
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/google/callback',
});

// Calendly OAuth (multi-account/public apps; auto-refresh, PKCE)
createConnectorFromTemplate('my-calendly-oauth', 'calendly', 'oauth-user', {
  clientId: process.env.CALENDLY_CLIENT_ID!,
  clientSecret: process.env.CALENDLY_CLIENT_SECRET!,
  redirectUri: 'https://myapp.com/calendly/callback',
});
```

#### Service Account (JWT Bearer)

For server-to-server authentication:

```typescript
// Google Service Account (same unified 'google-api' vendor template)
createConnectorFromTemplate('my-gcp', 'google-api', 'service-account', {
  clientId: process.env.GOOGLE_SERVICE_CLIENT_ID!,
  privateKey: process.env.GOOGLE_SERVICE_PRIVATE_KEY!,
  scope: 'https://www.googleapis.com/auth/cloud-platform'
});

// Salesforce JWT Bearer
createConnectorFromTemplate('my-salesforce', 'salesforce', 'jwt-bearer', {
  clientId: process.env.SF_CLIENT_ID!,
  privateKey: process.env.SF_PRIVATE_KEY!,
  username: process.env.SF_USERNAME!
});
```

#### Client Credentials

For app-level authentication:

```typescript
// Microsoft 365 App-Only (unified 'microsoft' vendor template covers 365, Teams, OneDrive, Outlook)
createConnectorFromTemplate('my-m365', 'microsoft', 'client-credentials', {
  clientId: process.env.AZURE_CLIENT_ID!,
  clientSecret: process.env.AZURE_CLIENT_SECRET!,
  tenantId: process.env.AZURE_TENANT_ID!
});

// PayPal
createConnectorFromTemplate('my-paypal', 'paypal', 'oauth-client-credentials', {
  clientId: process.env.PAYPAL_CLIENT_ID!,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET!
});
```

### Getting Credentials Setup URLs

Each vendor template includes the URL where you create credentials:

```typescript
import { getCredentialsSetupURL, getDocsURL } from '@everworker/oneringai';

// Get where to create credentials
const setupUrl = getCredentialsSetupURL('github');
// 'https://github.com/settings/developers'

// Get API documentation
const docsUrl = getDocsURL('github');
// 'https://docs.github.com/en/rest'
```

### Configuration Options

Override defaults when creating connectors:

```typescript
createConnectorFromTemplate(
  'my-github',
  'github',
  'pat',
  { apiKey: process.env.GITHUB_TOKEN! },
  {
    // Override baseURL (e.g., for GitHub Enterprise)
    baseURL: 'https://github.mycompany.com/api/v3',

    // Add description
    description: 'GitHub connector for CI/CD automation',

    // Set display name
    displayName: 'GitHub (Production)',

    // Configure timeout
    timeout: 30000,

    // Enable logging
    logging: true,
  }
);
```

### Complete Vendor Reference

#### Major Vendors (2 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Microsoft | `microsoft` | `oauth-user`, `client-credentials` | [Azure app registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) |
| Google Workspace | `google-api` | `oauth-user`, `service-account` | [Google Cloud credentials](https://console.cloud.google.com/apis/credentials) |

#### Communication (6 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Slack | `slack` | `bot-token`, `oauth-user` | [api.slack.com/apps](https://api.slack.com/apps) |
| Discord | `discord` | `bot-token`, `oauth-user` | [discord.com/developers](https://discord.com/developers/applications) |
| Telegram | `telegram` | `bot-token` | [t.me/BotFather](https://t.me/BotFather) |
| X (Twitter) | `twitter` | `oauth-user`, `bearer-token` | [developer.x.com](https://developer.x.com/en/portal/dashboard) |
| Zoom | `zoom` | `oauth-user`, `server-to-server` | [marketplace.zoom.us](https://marketplace.zoom.us/develop/create) |
| HeyReach | `heyreach` | `api-key` | [app.heyreach.io](https://app.heyreach.io/) |

#### Development (7 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| GitHub | `github` | `pat`, `oauth-user`, `github-app` | [github.com/settings/developers](https://github.com/settings/developers) |
| GitLab | `gitlab` | `pat`, `oauth-user` | [gitlab.com/-/profile/personal_access_tokens](https://gitlab.com/-/profile/personal_access_tokens) |
| Bitbucket | `bitbucket` | `app-password`, `oauth-user` | [bitbucket.org/account/settings/app-passwords](https://bitbucket.org/account/settings/app-passwords/) |
| Jira | `jira` | `api-token`, `oauth-3lo` | [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| Linear | `linear` | `api-key`, `oauth-user` | [linear.app/settings/api](https://linear.app/settings/api) |
| Asana | `asana` | `pat`, `oauth-user` | [app.asana.com/0/developer-console](https://app.asana.com/0/developer-console) |
| Trello | `trello` | `api-key`, `oauth-user` | [trello.com/power-ups/admin](https://trello.com/power-ups/admin) |

#### Productivity (5 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Notion | `notion` | `internal-token`, `oauth-user` | [notion.so/my-integrations](https://www.notion.so/my-integrations) |
| Airtable | `airtable` | `pat`, `oauth-user` | [airtable.com/create/tokens](https://airtable.com/create/tokens) |
| Confluence | `confluence` | `api-token`, `oauth-3lo` | [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |
| Cal.com | `cal-com` | `api-key` | [Cal.com API keys](https://app.cal.com/settings/developer/api-keys) |
| Calendly | `calendly` | `personal-token`, `oauth-user` | [Calendly integrations](https://calendly.com/integrations/api_webhooks) |

Google Workspace and Microsoft 365 use the unified `google-api` and `microsoft`
templates listed under Major Vendors; there are no separate product-specific
template IDs.

#### CRM (3 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Salesforce | `salesforce` | `oauth-user`, `jwt-bearer` | [Salesforce Connected Apps](https://login.salesforce.com/lightning/setup/ConnectedApplication/home) |
| HubSpot | `hubspot` | `api-key`, `oauth-user`, `oauth-mcp` | [developers.hubspot.com](https://developers.hubspot.com/get-started) |
| Pipedrive | `pipedrive` | `api-token`, `oauth-user` | [app.pipedrive.com/settings/api](https://app.pipedrive.com/settings/api) |

#### Payments (4 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Stripe | `stripe` | `api-key`, `oauth-connect` | [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys) |
| PayPal | `paypal` | `oauth-client-credentials` | [developer.paypal.com/dashboard](https://developer.paypal.com/dashboard/applications) |
| QuickBooks | `quickbooks` | `oauth-user` | [developer.intuit.com](https://developer.intuit.com/app/developer/dashboard) |
| Ramp | `ramp` | `oauth-client-credentials`, `oauth-user` | [app.ramp.com/settings/developer](https://app.ramp.com/settings/developer) |

#### Cloud (2 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| AWS | `aws` | `access-key` | [AWS IAM Console](https://console.aws.amazon.com/iam/home#/security_credentials) |
| Cloudflare | `cloudflare` | `api-token`, `global-api-key` | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) |

#### Storage (2 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Dropbox | `dropbox` | `oauth-user` | [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) |
| Box | `box` | `oauth-user`, `client-credentials` | [developer.box.com/console](https://developer.box.com/console) |

#### Email (5 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| SendGrid | `sendgrid` | `api-key` | [app.sendgrid.com/settings/api_keys](https://app.sendgrid.com/settings/api_keys) |
| Mailchimp | `mailchimp` | `api-key`, `oauth-user` | [admin.mailchimp.com/account/api](https://admin.mailchimp.com/account/api/) |
| Mailgun | `mailgun` | `api-key` | [app.mailgun.com/settings/api_security](https://app.mailgun.com/settings/api_security) |
| Postmark | `postmark` | `server-token`, `account-token` | [account.postmarkapp.com/api_tokens](https://account.postmarkapp.com/api_tokens) |
| EmailBison | `emailbison` | `api-token` | [EmailBison authentication](https://docs.emailbison.com/get-started/authentication) |

#### Monitoring (3 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Datadog | `datadog` | `api-key` | [app.datadoghq.com/organization-settings/api-keys](https://app.datadoghq.com/organization-settings/api-keys) |
| PagerDuty | `pagerduty` | `api-key`, `oauth-user` | [PagerDuty API Keys](https://support.pagerduty.com/main/docs/api-access-keys) |
| Sentry | `sentry` | `auth-token`, `oauth-user` | [sentry.io/settings/account/api/auth-tokens](https://sentry.io/settings/account/api/auth-tokens/) |

#### Search (4 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Serper | `serper` | `api-key` | [serper.dev/api-key](https://serper.dev/api-key) |
| Brave Search | `brave-search` | `api-key` | [brave.com/search/api](https://brave.com/search/api/) |
| Tavily | `tavily` | `api-key` | [tavily.com/#api](https://tavily.com/#api) |
| RapidAPI Web Search | `rapidapi-search` | `api-key` | [rapidapi.com/developer/dashboard](https://rapidapi.com/developer/dashboard) |

#### Scrape (1 vendor)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| ZenRows | `zenrows` | `api-key` | [zenrows.com/register](https://www.zenrows.com/register) |

#### Other (6 vendors)

| Vendor | ID | Auth Methods | Credentials URL |
|--------|-----|-------------|-----------------|
| Twilio | `twilio` | `api-key`, `api-key-sid` | [Twilio Console](https://console.twilio.com/us1/account/keys-credentials/api-keys) |
| Zendesk | `zendesk` | `api-token`, `oauth-user` | [Zendesk API Tokens](https://support.zendesk.com/hc/en-us/articles/4408889192858) |
| Intercom | `intercom` | `access-token`, `oauth-user` | [developers.intercom.com](https://developers.intercom.com/docs/build-an-integration) |
| Shopify | `shopify` | `access-token`, `oauth-user` | [partners.shopify.com](https://partners.shopify.com/) |
| ipinfo | `ipinfo` | `api-key` | [ipinfo.io/signup](https://ipinfo.io/signup) |
| Clay | `clay` | `api-key` | [Clay API key guide](https://university.clay.com/docs/guide-find-clay-api-key) |

### Template vs Manual Configuration

**Use templates when:**
- Setting up a well-known service
- You want sensible defaults for headers, URLs, and scopes
- You want the credentials setup URL handy

**Use manual Connector.create() when:**
- Connecting to a custom API not in the template list
- You need complete control over configuration
- The service has non-standard authentication

```typescript
// Template approach (recommended for supported vendors)
createConnectorFromTemplate('my-github', 'github', 'pat', {
  apiKey: process.env.GITHUB_TOKEN!
});

// Manual approach (for custom/unsupported APIs)
Connector.create({
  name: 'my-custom-api',
  serviceType: 'custom',
  auth: {
    type: 'api_key',
    apiKey: process.env.CUSTOM_API_KEY!,
    headerName: 'X-Custom-Auth',
    headerPrefix: '',
  },
  baseURL: 'https://api.custom-service.com/v1',
});
```

---

## OAuth for External APIs

The library includes full OAuth 2.0 support for external APIs.

### Basic OAuth Setup

```typescript
import { OAuthManager, FileStorage } from '@everworker/oneringai';

const oauth = new OAuthManager({
  flow: 'authorization_code',
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  redirectUri: 'http://localhost:3000/callback',
  scope: 'repo user',

  // Token storage
  storage: new FileStorage({
    directory: './tokens',
    encryptionKey: process.env.OAUTH_ENCRYPTION_KEY,
  }),
});

// Start OAuth flow
const authUrl = await oauth.startAuthFlow('user-123');
console.log('Visit:', authUrl);

// After user authorizes and is redirected back with ?code=...&state=...
await oauth.handleCallback(callbackUrl, 'user-123');  // Result can be ignored for ordinary OAuth API access

// Use token
const accessToken = await oauth.getToken('user-123');  // returns the access token string
```

### OpenID Connect callback result

`OAuthManager.handleCallback()` and `Connector.handleCallback()` return an
`OAuthCallbackResult` (`{ idToken?: string }`), exported from
`@everworker/oneringai`. For providers that return `id_token`, the result contains
that raw token; otherwise it is `{}`. Existing callers can continue to ignore
the result. Wrappers explicitly typed as `Promise<void>` must either await and
discard the result or update their return type.

An ID token is **not verified** by this API. Before using it to authenticate a
user, the host must verify its signature, issuer, exact client audience, expiry
and the attempt's nonce. The library does not persist it in `StoredToken`, make
it available through `getToken()`, or return it again during access-token refresh.
Do not log the ID token or expose it to an untrusted client. Access and refresh
token storage and user/account scoping are unchanged.

### Authenticated Fetch

```typescript
import { createAuthenticatedFetch } from '@everworker/oneringai';

// Create connector for external API using a pre-obtained access token
Connector.create({
  name: 'github',
  vendor: Vendor.Custom,
  auth: {
    type: 'api_key',
    apiKey: userToken.access_token,
    headerName: 'Authorization',
    headerPrefix: 'Bearer',
  },
});

// Create authenticated fetch
const githubFetch = createAuthenticatedFetch('github');

// Make API calls (automatically refreshes tokens)
const response = await githubFetch('https://api.github.com/user/repos');
const repos = await response.json();
```

### OAuth as a Connector

```typescript
// Create connector with a pre-obtained access token
Connector.create({
  name: 'microsoft-graph',
  vendor: Vendor.Custom,
  baseURL: 'https://graph.microsoft.com/v1.0',
  auth: {
    type: 'api_key',
    apiKey: token.access_token,
    headerName: 'Authorization',
    headerPrefix: 'Bearer',
  },
});

// Use in tools
const listEmailsTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'list_emails',
      description: 'List user emails',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  execute: async () => {
    const fetch = createAuthenticatedFetch('microsoft-graph');
    const response = await fetch('/me/messages');
    return await response.json();
  },
};

// Use with agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [listEmailsTool],
});

await agent.run('Show me my recent emails');
```

---

## Model Registry

The library includes registry schema v2 metadata for 96 text/realtime models,
plus separate TTS, STT, image, video, and embedding registries.

### Using the Model Registry

```typescript
import {
  getModelInfo,
  calculateCost,
  getModelsByVendor,
  getActiveModels,
  getDeprecatedModels,
  LLM_MODELS,
  MODEL_REGISTRY_SCHEMA_VERSION,
  Vendor,
} from '@everworker/oneringai';

// Get model information
const model = getModelInfo('gpt-6-astra');
console.log(model.provider);                   // 'openai'
console.log(MODEL_REGISTRY_SCHEMA_VERSION);   // 2
console.log(model.features.input.tokens);     // 922000 maximum input (1,050,000 total context)
console.log(model.features.output.tokens);    // 128000
console.log(model.features.reasoning);        // true
console.log(model.features.vision);           // true
console.log(model.lifecycle);                  // 'active'
console.log(model.endpoints);                  // ['responses', 'chat_completions', 'batch']

// Calculate API costs
const cost = calculateCost('gpt-5.6-luna', 50000, 2000);
console.log(`Cost: $${cost}`); // $0.0124

// With mixed cached and uncached input, using batch pricing
const cachedCost = calculateCost('gpt-5.6-luna', 50000, 2000, {
  cachedInputTokens: 30000,
  processingMode: 'batch',
});
console.log(`Optimized: $${cachedCost}`); // $0.0035

// Get all models for a vendor
const openaiModels = getModelsByVendor(Vendor.OpenAI);
console.log(openaiModels.map(m => m.name));
// ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', ...]

// Get all active models
const activeModels = getActiveModels();
console.log(activeModels.length); // lifecycle-aware active records only

// Use model constants
const flagship = LLM_MODELS[Vendor.OpenAI].GPT_6_ASTRA;
const efficient = LLM_MODELS[Vendor.OpenAI].GPT_5_6_LUNA;
```

### Registry schema v2 and API compatibility

Schema v2 is additive for existing consumers. `name`, `provider`, `isActive`,
features, and the original cost fields retain their meaning. New metadata is:

- `lifecycle`: `preview`, `active`, `legacy`, `deprecated`, or `retired`;
- `availability`, `preferred`, `aliases`, and `snapshots`;
- `endpoints`, `deprecationDate`, `retirementDate`, and `replacementModel`;
- official `sources` on media records and newly audited text entries; and
- long-context, processing-mode, duration, message, resolution, and modality
  pricing where the vendor publishes it.

Unknown token limits are represented as `null`, not `0`. This currently matters
for duration-priced voice-agent models. Existing code that assumes a number
should use `resolveMaxContextTokens()` or check for `null`.

Lookup helpers resolve aliases. Direct indexing remains canonical-only:

```typescript
getModelInfo('gpt-5.6')?.name;          // 'gpt-5.6-sol'
getModelInfo('grok-voice-latest')?.name; // 'grok-voice-think-fast-2.0'
MODEL_REGISTRY['gpt-5.6'];              // undefined by design
```

Use `getDeprecatedModels()` and the equivalent media helpers instead of treating
every callable-but-deprecated model as inactive. `isActive` means the API can
still be called; `lifecycle` carries the vendor's migration state.

### Current provider API selection

- OpenAI text models use Responses by default, including current reasoning,
  service-tier, explicit/implicit prompt-cache, and long-context cost metadata.
- Anthropic supports adaptive thinking, effort through `output_config`, and
  Opus fast mode through the current SDK options. Generic request metadata is
  narrowed to Anthropic's supported `{ user_id }` shape; unrelated host keys
  remain local rather than producing invalid Messages requests.
- Gemini 3.5+ uses the GA Interactions API (`steps`, `step.delta`) by default.
  Set `vendorOptions.api = 'generateContent'` to retain the legacy path, or
  `vendorOptions.api = 'interactions'` to force Interactions on another model.
  Named function selection is strict on both paths (`allowed_tools` for
  Interactions and `allowedFunctionNames` for `generateContent`).
- xAI text remains OpenAI-compatible; dedicated image, video, TTS, STT, and
  realtime voice endpoints use their native request contracts.

### Resolve Model Capabilities

Providers use the registry to resolve model capabilities automatically, but you can also use the helper directly:

```typescript
import { resolveModelCapabilities, resolveMaxContextTokens } from '@everworker/oneringai';

// Get full capabilities for a registered model
const caps = resolveModelCapabilities('gpt-5.6-terra', {
  supportsTools: true, supportsVision: false, supportsJSON: true,
  supportsJSONSchema: false, maxTokens: 128000, maxOutputTokens: 4096,
});
console.log(caps.maxTokens);       // 1050000 (from registry)
console.log(caps.maxOutputTokens); // 128000 (from registry)

// For unregistered models, vendor defaults are returned
const unknown = resolveModelCapabilities('my-custom-model', { ...vendorDefaults });
console.log(unknown.maxTokens);    // falls back to vendorDefaults

// Quick context limit lookup (useful for error messages)
const limit = resolveMaxContextTokens('gpt-5.6-terra', 128000);
console.log(limit); // 1050000
```

### Model Information

```typescript
interface ILLMDescription {
  name: string;
  provider: string;
  description?: string;
  isActive: boolean; // callable, not necessarily recommended
  lifecycle?: 'preview' | 'active' | 'legacy' | 'deprecated' | 'retired';
  availability?: 'public' | 'limited' | 'invite_only' | 'enterprise' | 'region_limited';
  preferred?: boolean;
  aliases?: readonly string[];
  snapshots?: readonly string[];
  endpoints?: readonly ModelEndpoint[];
  releaseDate?: string;
  deprecationDate?: string;
  retirementDate?: string;
  replacementModel?: string;
  knowledgeCutoff?: string;
  sources?: {
    documentation: string;
    pricing?: string;
    apiReference?: string;
    lastVerified: string;
  };

  features: {
    input: {
      tokens: number | null;
      cpm: number;
      cpmCached?: number;
    };
    output: {
      tokens: number | null;
      cpm: number;
    };

    // Feature flags
    reasoning: boolean;
    streaming: boolean;
    structuredOutput: boolean;
    functionCalling: boolean;
    vision: boolean;
    audio: boolean;
    video: boolean;
    extendedThinking: boolean;
    batchAPI: boolean;
    promptCaching: boolean;

    pricing?: {
      text?: TokenPricing;
      audio?: TokenPricing;
      image?: TokenPricing;
      audioDurationPerMinute?: number;
      textInputPerMessage?: number;
      processingMultipliers?: Partial<Record<ProcessingMode, number>>;
    };
  };
}
```

### Available Models

**OpenAI (49 models):**
- GPT-6: Astra (current flagship; limited rollout)
- GPT-5.6: Sol, Terra, Luna
- GPT-5.5 Pro
- GPT-5.3: codex, chat-latest
- GPT-5.2: standard, pro, codex, chat-latest
- GPT-5.1: standard, codex, codex-max, codex-mini, chat-latest
- GPT-5: standard, mini, nano, codex, chat-latest
- GPT-4.1: standard, mini, nano
- GPT-4o: standard, mini
- Audio: gpt-audio-1.5, gpt-audio, gpt-audio-mini
- Realtime: gpt-realtime-2.1 (recommended), gpt-realtime-2.1-mini, gpt-realtime-2, gpt-realtime-translate, gpt-realtime-1.5; gpt-realtime and gpt-realtime-mini are deprecated
- Realtime transcription: gpt-live-transcribe (recommended) and gpt-realtime-whisper ($0.017/audio minute)
- o-series: o3, o4-mini, o3-mini, o1
- Deep Research: o3-deep-research, o4-mini-deep-research
- Open-weight: gpt-oss-120b, gpt-oss-20b

**Anthropic (15 models):**
- Claude 5: Opus 5, Mythos 5, Fable 5
- Opus 4.8 and Sonnet 5
- Claude 4.7: Opus 4.7 (legacy flagship)
- Claude 4.6: Opus 4.6, Sonnet 4.6
- Claude 4.5: Opus, Sonnet, Haiku
- Claude 4.x legacy: Opus 4.1, Opus 4, Sonnet 4
- Claude 3.7: Sonnet

**Google (15 models):**
- Gemini 3.7 and 3.6 Flash; Gemini 3.5 and 3.5 Flash-Lite
- Gemini 3.1: Pro, Flash-Lite, Flash Image, Flash Live
- Gemini 3 (preview): Flash, Pro Image
- Gemini 2.5: Pro, Flash, Flash-Lite, Flash Image

**Grok / xAI (12 models):**
- Grok 4.6, Grok 4.5, Grok 4.3, and Grok Build 0.1
- Grok 4.20 (2M context, flagship): reasoning, non-reasoning, multi-agent
- Grok 4.1 fast (2M context): reasoning, non-reasoning
- Grok Voice Think Fast 2.0 and maintained 1.0 migration entries

**DeepSeek (5 models):**
- V4 Flash, V4 Pro, and V4 Flash Vision Experimental
- Retired `deepseek-chat` and `deepseek-reasoner` compatibility records

Dedicated media registries add GPT Image 2, Gemini 3.1 Flash/Lite Image, Grok
Imagine Image Quality, Sora 2, Veo/Omni, Grok Imagine Video 1.5, current OpenAI
and xAI speech models, Google/xAI TTS/STT, and Gemini Embedding 2. Use
`getImageModelInfo`, `getVideoModelInfo`, `getTTSModelInfo`, `getSTTModelInfo`,
and `getEmbeddingModelInfo` for their modality-specific capability schemas.

The complete official-source audit and migration table is in
[`docs/MODEL_REGISTRY_AUDIT.md`](./docs/MODEL_REGISTRY_AUDIT.md).

---

## Scoped Connector Registry

In multi-user or multi-tenant systems, you often need to limit which connectors are visible to which users. The **Scoped Connector Registry** provides a pluggable access control layer over the Connector registry — a lightweight filtered view gated by a user-provided policy predicate. Zero changes to the existing API; scoping is entirely opt-in.

### Access Control Policies

Define a policy that determines which connectors a given context can access:

```typescript
import { Connector, ScopedConnectorRegistry } from '@everworker/oneringai';
import type { IConnectorAccessPolicy, ConnectorAccessContext } from '@everworker/oneringai';

// Tag-based policy: connector must have a matching tenant tag
const tenantPolicy: IConnectorAccessPolicy = {
  canAccess: (connector, context) => {
    const tags = connector.config.tags as string[] | undefined;
    const tenantId = context.tenantId as string;
    return !!tags && tags.includes(tenantId);
  },
};

// Role-based policy
const rolePolicy: IConnectorAccessPolicy = {
  canAccess: (connector, context) => {
    const roles = context.roles as string[];
    if (roles.includes('admin')) return true;
    // Non-admins can only see connectors in their department
    const dept = connector.config.tags as string[] | undefined;
    return !!dept && dept.includes(context.department as string);
  },
};
```

**Policy rules:**
- `canAccess()` is **synchronous** — access checks must be fast, policy data should be in-memory
- `context` is an opaque `Record<string, unknown>` — the library imposes no structure
- The policy receives the full `Connector` instance so it can inspect `config.tags`, `vendor`, `serviceType`, `baseURL`, etc.

### Setting a Global Policy

```typescript
// Set the policy (required before calling Connector.scoped())
Connector.setAccessPolicy(tenantPolicy);

// Check current policy
const current = Connector.getAccessPolicy(); // IConnectorAccessPolicy | null

// Clear the policy
Connector.setAccessPolicy(null);
```

### Creating Scoped Views

```typescript
// Create a scoped view for tenant "acme"
const acmeRegistry = Connector.scoped({ tenantId: 'acme' });

// Only connectors tagged with "acme" are visible
acmeRegistry.list();       // ['acme-openai', 'acme-slack']
acmeRegistry.size();       // 2
acmeRegistry.has('other'); // false

// Accessing a denied connector gives the same "not found" error
// as a truly non-existent one — no information leakage
acmeRegistry.get('competitor-key');
// throws: "Connector 'competitor-key' not found. Available: acme-openai, acme-slack"
```

You can also create a `ScopedConnectorRegistry` directly with any policy (not just the global one):

```typescript
import { ScopedConnectorRegistry } from '@everworker/oneringai';

const custom = new ScopedConnectorRegistry(myPolicy, { userId: 'user-123' });
```

### Unfiltered Admin View

When your code accepts `IConnectorRegistry` but you want the full, unfiltered view:

```typescript
import type { IConnectorRegistry } from '@everworker/oneringai';

// Returns an IConnectorRegistry that delegates to Connector static methods
const adminRegistry: IConnectorRegistry = Connector.asRegistry();

// Full access, no filtering
adminRegistry.list(); // all connectors
```

### Using with Agent

Pass a scoped registry to `Agent.create()` via the `registry` option:

```typescript
const registry = Connector.scoped({ tenantId: 'acme' });

const agent = Agent.create({
  connector: 'acme-openai',  // Resolved via scoped registry
  model: 'gpt-4.1',
  registry,
});

// The agent can only see connectors accessible to 'acme'
```

If the connector name isn't accessible through the scoped registry, agent creation throws the standard "Connector not found" error listing only visible connectors.

### Using with ConnectorTools

All major `ConnectorTools` methods accept an optional `{ registry }` option:

```typescript
const registry = Connector.scoped({ tenantId: 'acme' });

// Get tools for a specific connector (resolved via scoped registry)
const tools = ConnectorTools.for('acme-slack', undefined, { registry });

// Discover tools for all accessible connectors
const allTools = ConnectorTools.discoverAll(undefined, { registry });

// Find connectors by service type (searches only accessible connectors)
const github = ConnectorTools.findConnector('github', { registry });
const allGithubs = ConnectorTools.findConnectors('github', { registry });
```

### Multi-Tenant Example

```typescript
import { Connector, Agent, Vendor, ConnectorTools } from '@everworker/oneringai';
import type { IConnectorAccessPolicy } from '@everworker/oneringai';

// 1. Create connectors with tenant tags
Connector.create({
  name: 'acme-openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.ACME_OPENAI_KEY! },
  tags: ['acme'],
});

Connector.create({
  name: 'globex-openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.GLOBEX_OPENAI_KEY! },
  tags: ['globex'],
});

Connector.create({
  name: 'acme-github',
  auth: { type: 'api_key', apiKey: process.env.ACME_GITHUB_TOKEN! },
  baseURL: 'https://api.github.com',
  tags: ['acme'],
});

// 2. Set up the policy
const policy: IConnectorAccessPolicy = {
  canAccess: (connector, ctx) => {
    const tags = connector.config.tags as string[] | undefined;
    return !!tags && tags.includes(ctx.tenantId as string);
  },
};
Connector.setAccessPolicy(policy);

// 3. Per-request: create a scoped view
function handleRequest(tenantId: string) {
  const registry = Connector.scoped({ tenantId });

  // This tenant can only see their own connectors
  const agent = Agent.create({
    connector: `${tenantId}-openai`,
    model: 'gpt-4.1',
    registry,
  });

  // Discover tools only for this tenant's connectors
  const tools = ConnectorTools.discoverAll(undefined, { registry });

  return { agent, tools };
}

// Acme sees: acme-openai, acme-github
handleRequest('acme');

// Globex sees: globex-openai
handleRequest('globex');
```

### IConnectorRegistry Interface

The `IConnectorRegistry` interface covers the read-only subset of Connector static methods:

| Method | Description |
|--------|-------------|
| `get(name)` | Get connector by name (throws if not found/denied) |
| `has(name)` | Check if connector exists and is accessible |
| `list()` | List accessible connector names |
| `listAll()` | List accessible connector instances |
| `size()` | Count of accessible connectors |
| `getDescriptionsForTools()` | Formatted descriptions for LLM tool parameters |
| `getInfo()` | Connector info map for UI/documentation |
| `getById(id)` | Optional ID lookup; same error contract as `get(name)` |

Missing connectors throw the public `ConnectorNotFoundError`, which extends
`AIError` and carries `code: 'CONNECTOR_NOT_FOUND'`. Scoped registries and agent
identity views use the same error for hidden connectors; absence does not reveal
whether a connector exists in another scope. The error has no HTTP status: the
host decides how to report it and whether an optional read can use a separately
authorized cache. It never grants access to a connector or cached data.

Custom `IConnectorRegistry` implementations should throw this error for missing
or scope-hidden connectors. `Connector.get()` and `Connector.getById()` delegate
without wrapping errors: authentication, broken configuration and storage errors
must propagate as their original failures, not be converted into absence.

```typescript
import { ConnectorNotFoundError } from '@everworker/oneringai';

// Inside a custom registry, after applying its scope/visibility checks:
throw new ConnectorNotFoundError();
```

The default message is safe and generic. A custom diagnostic message and optional
original error may be supplied as `new ConnectorNotFoundError(message, cause)`.
Built-in diagnostics retain the requested name/ID and visible connector names;
HTTP adapters should avoid exposing these diagnostics to clients.

---

## Agent Registry

The `AgentRegistry` is a global static registry that automatically tracks all active `Agent` instances. It provides observability, deep inspection, parent/child relationship tracking, event fan-in, and external control — all from one central place.

### Automatic Tracking

Every agent auto-registers on creation and auto-unregisters on destroy. No setup required:

```typescript
import { Agent, AgentRegistry } from '@everworker/oneringai';

const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1', name: 'assistant' });
AgentRegistry.count;  // 1
AgentRegistry.has(agent.registryId);  // true

agent.destroy();
AgentRegistry.count;  // 0
```

Each agent gets a unique `registryId` (UUID) on creation. Agent names are NOT unique — multiple agents can share a name.

### Query

```typescript
// By unique ID
AgentRegistry.get(agent.registryId);

// By name (returns array — names aren't unique)
AgentRegistry.getByName('assistant');

// Filter with AND logic
AgentRegistry.filter({ model: 'gpt-4.1', status: 'running' });
AgentRegistry.filter({ status: ['idle', 'running'] });  // match any of these statuses
AgentRegistry.filter({ connector: 'openai', parentAgentId: parent.registryId });

// Lightweight info snapshots
const infos = AgentRegistry.listInfo();  // AgentInfo[]
// Each: { id, name, model, connector, status, createdAt, parentAgentId, childAgentIds }

// Aggregate stats
const stats = AgentRegistry.getStats();
// { total, byStatus: { idle, running, paused, cancelled, destroyed }, byModel, byConnector }

// Aggregate metrics across all agents
const metrics = AgentRegistry.getAggregateMetrics();
// { totalAgents, activeExecutions, totalTokens, totalToolCalls, totalErrors, byModel, byConnector }
```

### Deep Inspection

The `inspect()` method returns everything about an agent — full context snapshot, conversation history, plugin states, tools, execution metrics, audit trail, and circuit breaker states:

```typescript
const inspection = await AgentRegistry.inspect(agent.registryId);

// Context snapshot (from agent.getSnapshot())
inspection.context.plugins;       // IPluginSnapshot[] — all plugin states
inspection.context.tools;         // IToolSnapshot[] — all tools with call counts
inspection.context.budget;        // ContextBudget — token usage breakdown
inspection.context.systemPrompt;  // string | null
inspection.context.features;      // { workingMemory, inContextMemory, ... }

// Full conversation
inspection.conversation;          // ReadonlyArray<InputItem>
inspection.currentInput;          // ReadonlyArray<InputItem> — pending input

// Execution state
inspection.execution.id;          // current executionId or null
inspection.execution.iteration;   // current iteration
inspection.execution.metrics;     // ExecutionMetrics (tokens, tool calls, durations, errors)
inspection.execution.auditTrail;  // AuditEntry[] (hook executions, tool skips, permissions)

// Tool manager
inspection.toolStats;             // ToolManagerStats
inspection.circuitBreakers;       // Map<string, CircuitState>

// Children
inspection.children;              // AgentInfo[] — child agent snapshots

// Bulk inspection
const all = await AgentRegistry.inspectAll();
const filtered = await AgentRegistry.inspectMatching({ model: 'gpt-4.1' });
```

### Parent/Child Hierarchy

Agents can track parent/child relationships for hierarchical agent architectures:

```typescript
// Create parent
const orchestrator = Agent.create({ connector: 'openai', model: 'gpt-4.1', name: 'orchestrator' });

// Create children linked to parent
const researcher = Agent.create({
  connector: 'openai', model: 'gpt-4.1', name: 'researcher',
  parentAgentId: orchestrator.registryId,
});
const writer = Agent.create({
  connector: 'anthropic', model: 'claude-sonnet-4-6', name: 'writer',
  parentAgentId: orchestrator.registryId,
});

// Query relationships
AgentRegistry.getChildren(orchestrator.registryId);  // [researcher, writer]
AgentRegistry.getParent(researcher.registryId);      // orchestrator

// Recursive tree (for visualization/dashboards)
const tree = AgentRegistry.getTree(orchestrator.registryId);
// { info: orchestratorInfo, children: [
//   { info: researcherInfo, children: [] },
//   { info: writerInfo, children: [] },
// ]}

// Filter by parent
AgentRegistry.filter({ parentAgentId: orchestrator.registryId });
```

### Events

Registry lifecycle events:

```typescript
// Agent registered/unregistered
AgentRegistry.on('agent:registered', ({ agent, info }) => {
  console.log(`New agent: ${info.name} (${info.id})`);
});

AgentRegistry.on('agent:unregistered', ({ id, name, reason }) => {
  console.log(`Agent removed: ${name} (${reason})`);
});

// Status changes (tracked via agent's own EventEmitter)
AgentRegistry.on('agent:statusChanged', ({ id, name, previous, current }) => {
  console.log(`${name}: ${previous} -> ${current}`);
});

// Registry empty
AgentRegistry.on('registry:empty', () => {
  console.log('All agents destroyed');
});
```

#### Event Fan-In

Receive ALL events from ALL agents through a single callback — ideal for dashboards, logging pipelines, and monitoring:

```typescript
AgentRegistry.onAgentEvent((agentId, agentName, event, data) => {
  console.log(`[${agentName}] ${event}`, data);
  // "[researcher] execution:start" { executionId, config, timestamp }
  // "[researcher] tool:complete" { executionId, iteration, toolCall, result, timestamp }
  // "[writer] llm:response" { executionId, iteration, response, timestamp, duration }
});

// Stop listening
AgentRegistry.offAgentEvent(myListener);
```

Forwarded events include all agent events: `execution:*`, `iteration:*`, `llm:*`, `tool:*`, `hook:error`, `circuit:*`, `async:*`.

### External Control

Control agents without holding a direct reference:

```typescript
// Individual control
AgentRegistry.pauseAgent(id);
AgentRegistry.resumeAgent(id);
AgentRegistry.cancelAgent(id, 'timeout');
AgentRegistry.destroyAgent(id);

// Bulk control with filters
AgentRegistry.pauseMatching({ model: 'gpt-4.1' });
AgentRegistry.cancelMatching({ status: 'running' }, 'shutting down');
AgentRegistry.destroyMatching({ connector: 'openai' });

// Nuclear
AgentRegistry.pauseAll();
AgentRegistry.cancelAll('emergency shutdown');
AgentRegistry.destroyAll();
```

### Full API Reference

| Category | Method | Returns | Description |
|----------|--------|---------|-------------|
| **Query** | `get(id)` | `IRegistrableAgent?` | Get agent by unique ID |
| | `getByName(name)` | `IRegistrableAgent[]` | Get all agents with name |
| | `has(id)` | `boolean` | Check if agent exists |
| | `list()` | `string[]` | All registry IDs |
| | `filter(filter)` | `IRegistrableAgent[]` | Agents matching filter |
| | `count` | `number` | Total tracked agents |
| **Info** | `listInfo()` | `AgentInfo[]` | Lightweight snapshots |
| | `filterInfo(filter)` | `AgentInfo[]` | Filtered snapshots |
| **Inspection** | `inspect(id)` | `Promise<AgentInspection?>` | Deep inspection |
| | `inspectAll()` | `Promise<AgentInspection[]>` | Inspect all agents |
| | `inspectMatching(filter)` | `Promise<AgentInspection[]>` | Filtered inspection |
| **Aggregates** | `getStats()` | `AgentRegistryStats` | Counts by status/model/connector |
| | `getAggregateMetrics()` | `AggregateMetrics` | Tokens, tool calls, errors |
| **Hierarchy** | `getChildren(parentId)` | `IRegistrableAgent[]` | Child agents |
| | `getParent(childId)` | `IRegistrableAgent?` | Parent agent |
| | `getTree(rootId)` | `AgentTreeNode?` | Recursive tree |
| **Events** | `on(event, listener)` | `void` | Subscribe to lifecycle events |
| | `off(event, listener)` | `void` | Unsubscribe |
| | `once(event, listener)` | `void` | Subscribe once |
| | `onAgentEvent(listener)` | `void` | Fan-in: all agent events |
| | `offAgentEvent(listener)` | `void` | Remove fan-in listener |
| **Control** | `pauseAgent(id)` | `boolean` | Pause agent |
| | `resumeAgent(id)` | `boolean` | Resume agent |
| | `cancelAgent(id, reason?)` | `boolean` | Cancel agent |
| | `destroyAgent(id)` | `boolean` | Destroy agent |
| | `pauseMatching(filter)` | `number` | Bulk pause |
| | `cancelMatching(filter, reason?)` | `number` | Bulk cancel |
| | `destroyMatching(filter)` | `number` | Bulk destroy |
| | `pauseAll()` | `number` | Pause all |
| | `cancelAll(reason?)` | `number` | Cancel all |
| | `destroyAll()` | `number` | Destroy all |
| **Housekeeping** | `clear()` | `void` | Clear registry (testing) |

---

## Agent Orchestrator

Create autonomous agent teams that coordinate through a shared workspace. The orchestrator is a regular Agent with special tools — no subclass needed.

### Quick Start

```typescript
import { createOrchestrator, Connector, Vendor } from '@everworker/oneringai';

Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

const orchestrator = await createOrchestrator({
  connector: 'openai',
  model: 'gpt-4.1',
  agentTypes: {
    architect: {
      systemPrompt: 'You are a senior software architect. Design clean, scalable systems. Use the shared workspace to publish your designs.',
      tools: [readFile, writeFile],
    },
    critic: {
      systemPrompt: 'You are a thorough code reviewer. Read artifacts from the workspace, find issues, and post your review back to the workspace.',
      tools: [readFile, grep],
    },
    developer: {
      systemPrompt: 'You are a senior developer. Read the plan from the workspace, implement it, and update the workspace with your progress.',
      tools: [readFile, writeFile, editFile, bash],
    },
  },
});

const result = await orchestrator.run('Build an auth module with JWT support');
console.log(result.output_text);
```

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Orchestrator (Agent)                    │
│                                                           │
│  System prompt: auto-generated from agentTypes            │
│  Tools: 5 orchestration tools + workspace store tools     │
│                                                           │
├─────────────────────────────────────────────────────────┤
│           SharedWorkspace (shared instance)               │
│  - entries: plans, code, reviews, status                  │
│  - log: team conversation                                 │
│  - All agents read/write via store_*("workspace", ...)    │
├─────────────────────────────────────────────────────────┤
│                    Worker Agents                          │
│  - Persistent (remember reasoning across turns)           │
│  - Own context + shared workspace                         │
│  - Receive workspace delta at turn start                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │Architect │  │  Critic  │  │Developer │               │
│  └──────────┘  └──────────┘  └──────────┘               │
└─────────────────────────────────────────────────────────┘
```

### OrchestratorConfig

```typescript
interface OrchestratorConfig {
  connector: string;           // Connector for LLM access
  model: string;               // Model for orchestrator (default for workers too)
  systemPrompt?: string;       // Custom prompt (overrides auto-generated)
  agentTypes: Record<string, AgentTypeConfig>;  // Available worker types
  workspace?: Partial<SharedWorkspaceConfig>;    // Workspace settings
  features?: Partial<ContextFeatures>;           // Orchestrator context features
  pluginConfigs?: PluginConfigs;                 // Plugin configurations for the orchestrator
  name?: string;               // Orchestrator name (default: 'orchestrator')
  agentId?: string;            // For session persistence
  maxIterations?: number;      // Max loop iterations (default: 100)
  maxAgents?: number;          // Max worker agents (default: 20)
  skipPlanning?: boolean;      // Skip UNDERSTAND/PLAN/APPROVE phases (default: false)
  tools?: ToolFunction[];      // Tools available to the orchestrator for DIRECT-route tasks
  delegationDefaults?: DelegationDefaults; // Default delegation settings
  autoDescribe?: boolean;      // LLM-generated descriptions for agent types (default: false)
}

interface AgentTypeConfig {
  systemPrompt: string;        // Role-defining prompt
  tools?: ToolFunction[];      // Role-specific tools
  model?: string;              // Override model per type
  connector?: string;          // Override connector per type
  features?: Partial<ContextFeatures>;  // Worker context features
  plugins?: PluginConfigs;     // Worker plugin configurations
  description?: string;        // One-liner for routing (e.g., "Senior dev who writes and tests code")
  scenarios?: string[];        // When to use (e.g., ["implementing features", "fixing bugs"])
  capabilities?: string[];     // What it can do (e.g., ["read/write files", "run shell commands"])
}
```

### 3-Tier Routing

The orchestrator v2 uses a 3-tier routing model:

| Route | When | Behavior |
|-------|------|----------|
| **DIRECT** | Simple queries, quick lookups | Orchestrator handles directly using its own `tools` |
| **DELEGATE** | User needs extended interaction with a specialist | Hands user-facing session to a sub-agent via `delegate_interactive` |
| **ORCHESTRATE** | Complex multi-step tasks | Coordinates multiple workers via `assign_turn` + workspace |

### Orchestration Tools

The orchestrator gets 5 tools automatically:

#### Task Assignment

| Tool | Description |
|------|-------------|
| `assign_turn(agent, type, instruction)` | Assign work to an agent. Auto-creates the agent if it doesn't exist. Always async. Optional `autoDestroy` to clean up after completion. |
| `delegate_interactive(agent, type?, monitoring?, reclaimOn?, briefing?)` | Hand the user-facing session to a sub-agent. Supports `monitoring` (passive/active/event) and `reclaimOn` conditions (keyword, maxTurns, workspaceKey). |

#### Team Management

| Tool | Description |
|------|-------------|
| `list_agents()` | Returns all workers with name, model, status, plus current delegation state. |
| `destroy_agent(name)` | Destroy a worker. Auto-reclaims delegation if the destroyed agent was the delegatee. |

#### Communication

| Tool | Description |
|------|-------------|
| `send_message(agent, message)` | Inject a message into an agent's context. If the agent is running, the message appears on its next iteration. If idle, it's seen on the next turn. Uses `Agent.inject()`. |

### Workspace Delta

When a worker starts a turn, its instruction is automatically prepended with a workspace delta showing what changed since that worker's last turn:

```
[Workspace changes since your last turn]
- NEW: "auth_plan" (v1, by architect) — JWT auth design with refresh tokens
- UPDATED: "requirements" (v1→v2, by orchestrator) — Added rate limiting requirement
Recent log:
  [architect] Designed API following RESTful patterns
  [orchestrator] Added rate limiting to requirements

Design the authentication module based on the approved plan.
```

### Workflow Examples

#### Sequential Review Cycle

```typescript
const orchestrator = await createOrchestrator({
  connector: 'openai',
  model: 'gpt-4.1',
  agentTypes: {
    architect: { systemPrompt: 'You are a software architect...', tools: [readFile, writeFile] },
    critic: { systemPrompt: 'You are a code reviewer...', tools: [readFile] },
    developer: { systemPrompt: 'You are a developer...', tools: [readFile, writeFile, editFile, bash] },
  },
});

// The orchestrator LLM naturally follows this pattern:
// 1. assign_turn(agent="arch", type="architect", instruction="Design the auth module")
//    → auto-creates "arch" as an architect worker
// 2. assign_turn(agent="rev", type="critic", instruction="Review the architecture plan")
//    → auto-creates "rev" as a critic worker
// 3. If issues: assign_turn(agent="arch", instruction="Address reviewer feedback")
// 4. assign_turn(agent="dev", type="developer", instruction="Implement the approved plan")
// 5. assign_turn(agent="rev", instruction="Review the implementation")
// 6. If issues: assign_turn(agent="dev", instruction="Fix review comments")
// 7. Final acceptance → destroy_agent for each worker

const result = await orchestrator.run('Build a JWT auth module with refresh tokens');
```

#### Parallel Research

```typescript
const orchestrator = await createOrchestrator({
  connector: 'openai',
  model: 'gpt-4.1',
  agentTypes: {
    researcher: {
      systemPrompt: 'You are a research analyst. Search the web, analyze findings, and post results to the workspace.',
      tools: [webSearchTool, webFetchTool],
    },
    synthesizer: {
      systemPrompt: 'You are an analyst. Read research findings from the workspace and produce a comprehensive summary.',
    },
  },
});

// The orchestrator will (all assign_turn calls are async/non-blocking):
// 1. assign_turn(agent="r1", type="researcher", instruction="Research competitor A")
// 2. assign_turn(agent="r2", type="researcher", instruction="Research competitor B")
// 3. assign_turn(agent="r3", type="researcher", instruction="Research competitor C")
//    → All 3 run concurrently (assign_turn is always non-blocking)
// 4. When results arrive, assign_turn(agent="synth", type="synthesizer", instruction="Combine all research")

const result = await orchestrator.run('Research the top 3 competitors in the AI agent space');
```

#### Async Execution (All assign_turn Calls Are Non-Blocking)

```typescript
// assign_turn is always async (blocking: false). The orchestrator naturally
// launches multiple agents concurrently:
//
// 1. assign_turn(agent="r1", type="researcher", instruction="Research competitor A")
//    → Returns immediately, r1 starts working in background
//
// 2. assign_turn(agent="r2", type="researcher", instruction="Research competitor B")
//    → Returns immediately, r2 starts working in background
//
// 3. Orchestrator continues: updates workspace, plans next steps, talks to user
//
// 4. Results arrive via autoContinue (500ms batching window):
//    → "r1 completed: Found 5 key insights..."
//    → "r2 completed: Analysis complete..."
//
// The orchestrator classifies each result: complete, question, stuck, or partial.
// 3-strike rule: after 3 failed re-assignments, try different agent type or escalate.
```

#### Interactive Delegation

```typescript
// For extended interactive sessions (pair-programming, tutoring, debugging):
//
// delegate_interactive(agent="dev", type="developer",
//   monitoring="active",     // LLM reviews each turn, can intervene
//   reclaimOn={ keyword: "done", maxTurns: 20 },
//   briefing="User wants help implementing auth")
//
// User now talks directly to the "dev" agent.
// Orchestrator monitors and can inject guidance via send_message.
// Control returns when user says "done" or after 20 turns.
//
// Monitoring modes:
//   passive  — exchanges logged to workspace, reviewed when control returns
//   active   — LLM reviews each turn, can inject intervention messages
//   event    — notified when a specific workspace key appears
//
// Reclaim conditions:
//   keyword     — user says a word (regex match, e.g., "done", "back")
//   maxTurns    — auto-reclaim after N delegation turns
//   workspaceKey — reclaim when a specific workspace entry appears
```

### Agent.inject()

The `inject()` method enables orchestrator-to-worker communication:

```typescript
// Inject a message into a running or idle agent
agent.inject('Please also consider rate limiting in your design');
agent.inject('Switch to OAuth2 instead of JWT', 'developer');  // 'developer' role

// The message is queued and delivered on the agent's next agentic loop iteration.
// Safe to call while the agent is running.
```

This is used internally by the `send_message` orchestration tool, but can also be called directly on any Agent instance.

### Worker Agent Lifecycle

Workers are **persistent** — they remember their reasoning across turns:

1. **Created** via `assign_turn(agent=name, type=type, instruction=...)` — auto-creates with system prompt, tools, shared workspace
2. **Assigned turns** — each subsequent `assign_turn` calls `agent.run(instruction)` on the same instance
3. **Context accumulates** — the worker's context grows with each turn (compaction handles limits)
4. **Destroyed** via `destroy_agent(name)` or when the orchestrator is destroyed

### Custom System Prompt

Override the auto-generated prompt for specialized workflows:

```typescript
const orchestrator = await createOrchestrator({
  connector: 'openai',
  model: 'gpt-4.1',
  systemPrompt: `You are a QA team lead. For every task:
1. assign_turn a "developer" to write code
2. assign_turn a "tester" to write tests
3. Both run concurrently (assign_turn is always async)
4. If tests fail, send_message the failure details to the developer
5. assign_turn the developer again to fix, repeat until all tests pass`,
  agentTypes: {
    developer: { systemPrompt: '...', tools: [writeFile, editFile] },
    tester: { systemPrompt: '...', tools: [readFile, bash] },
  },
});
```

### Per-Type Configuration

Each agent type can have its own model, connector, and features:

```typescript
const orchestrator = await createOrchestrator({
  connector: 'openai',
  model: 'gpt-4.1',  // Default
  agentTypes: {
    planner: {
      systemPrompt: 'You are a strategic planner...',
      model: 'gpt-4.1',      // Use the best model for planning
      connector: 'openai',
    },
    coder: {
      systemPrompt: 'You are a fast coder...',
      model: 'gpt-4o-mini',  // Use a faster/cheaper model for coding
      connector: 'openai',
      tools: [readFile, writeFile, editFile, bash],
    },
    reviewer: {
      systemPrompt: 'You are a code reviewer...',
      model: 'claude-sonnet-4-20250514',  // Different provider entirely
      connector: 'anthropic',
      tools: [readFile, grep],
    },
  },
});
```

---

## Advanced Features

### Hooks & Lifecycle Events

#### Lifecycle Hooks (via AgentConfig)

Intercept tool execution, compaction, and error events:

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [myTool],

  // Lifecycle hooks
  lifecycleHooks: {
    beforeToolExecution: async (context) => {
      console.log(`About to call: ${context.toolName}`);
      // Throw to prevent execution
    },
    afterToolExecution: async (result) => {
      console.log(`Tool ${result.toolName} completed in ${result.durationMs}ms`);
    },
    beforeCompaction: async (context) => {
      console.log(`Compaction starting for agent ${context.agentId}`);
    },
    afterCompaction: async (log, tokensFreed) => {
      console.log(`Compaction freed ${tokensFreed} tokens`);
    },
    onError: async (error, context) => {
      console.error(`Error in ${context.phase}: ${error.message}`);
    },
  },
});
```

#### Execution Hooks (via HookConfig)

For finer control over the agentic loop, use the `hooks` config with named hook points:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  hooks: {
    'before:tool': async (context) => {
      console.log(`Calling ${context.toolCall.function.name}`);
      return {}; // Return a ToolModification, e.g. { modified: { function: { ...context.toolCall.function, arguments: '...' } } }
    },
    'after:tool': async (context) => {
      console.log(`Result: ${JSON.stringify(context.result)}`);
      return {}; // Return a ToolResultModification, e.g. { modified: { content: '...' } }
    },
    'approve:tool': async (context) => {
      // Return approval decision
      return { approved: true, reason: 'Approved' };
    },
  },
});
```

#### Context Events

Subscribe to context events for monitoring or host UI updates:

```typescript
const ctx = agent.context;

ctx.on('compaction:starting', ({ timestamp, targetTokensToFree }) => {
  console.log(`Compaction starting: need to free ~${targetTokensToFree} tokens`);
});

ctx.on('context:compacted', ({ tokensFreed }) => {
  console.log(`Compaction complete: freed ${tokensFreed} tokens`);
});
```

### Circuit Breaker

Protect external services:

```typescript
import { CircuitBreaker } from '@everworker/oneringai';

const breaker = new CircuitBreaker('my-breaker', {
  failureThreshold: 5,        // Open after 5 failures
  successThreshold: 2,        // Close after 2 successes
  resetTimeoutMs: 30000,      // Try again after 30 seconds
});

// Wrap API calls
const result = await breaker.execute(async () => {
  return await externalAPI.call();
});

// Monitor state
breaker.on('opened', ({ name, failureCount, nextRetryTime }) => {
  console.log(`Circuit '${name}' opened after ${failureCount} failures`);
});

// Get metrics
const metrics = breaker.getMetrics();
console.log(metrics);
// {
//   state: 'closed',
//   failureCount: 0,
//   successCount: 10,
//   totalRequests: 10,
//   consecutiveSuccesses: 10
// }
```

### Retry with Backoff

```typescript
import { retryWithBackoff } from '@everworker/oneringai';

const result = await retryWithBackoff(
  async () => {
    // Your operation
    return await apiCall();
  },
  {
    strategy: 'exponential',
    initialDelayMs: 1000,   // Start with 1 second
    maxDelayMs: 30000,      // Cap at 30 seconds
    multiplier: 2,          // Double each time
    jitter: true,           // Add randomness
  },
  5                          // maxAttempts (separate 3rd argument)
);
```

### Logging

```typescript
import { logger } from '@everworker/oneringai';

// Set log level
logger.updateConfig({ level: 'debug' }); // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent'

// Log messages
logger.debug('Debug message');
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');

// Structured logging
logger.info({ userId: '123', action: 'login' }, 'User action');
```

### Metrics

```typescript
import { metrics, setMetricsCollector, ConsoleMetrics } from '@everworker/oneringai';

// Use console metrics
setMetricsCollector(new ConsoleMetrics());

// Track metrics
metrics.increment('requests', 1, { endpoint: '/api/chat' });
metrics.gauge('active_connections', 42);
metrics.histogram('response_time', 125.5, { endpoint: '/api/chat' });

// Custom metrics collector
class CustomMetrics implements MetricsCollector {
  increment(name: string, value: number, tags?: Record<string, string>) {
    // Send to your metrics service
  }

  gauge(name: string, value: number, tags?: Record<string, string>) {
    // Send to your metrics service
  }

  timing(name: string, duration: number, tags?: Record<string, string>) {
    // Send to your metrics service
  }

  histogram(name: string, value: number, tags?: Record<string, string>) {
    // Send to your metrics service
  }
}

setMetricsCollector(new CustomMetrics());
```

---

## Production Deployment

### Environment Variables

```env
# AI Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# OAuth (32-byte hex key)
OAUTH_ENCRYPTION_KEY=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789

# Optional: Base URLs for proxies
OPENAI_BASE_URL=https://api.openai.com/v1
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Note: timeouts are configured per-tool/provider in code, not via env vars —
# there is no REQUEST_TIMEOUT env var read by the library.
```

### Error Handling

```typescript
import {
  Agent,
  ProviderAuthError,
  ProviderRateLimitError,
  ProviderContextLengthError,
  ToolExecutionError,
} from '@everworker/oneringai';

const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });

try {
  const response = await agent.run('Hello');
} catch (error) {
  if (error instanceof ProviderAuthError) {
    console.error('Authentication failed:', error.message);
    // Check API key
  } else if (error instanceof ProviderRateLimitError) {
    console.error('Rate limit exceeded:', error.message);
    // Retry with backoff
  } else if (error instanceof ProviderContextLengthError) {
    console.error('Context too long:', error.message);
    // Use context management
  } else if (error instanceof ToolExecutionError) {
    console.error('Tool failed:', error.message);
    // Handle tool error
  } else {
    console.error('Unknown error:', error);
  }
}
```

### Best Practices

#### 1. Use Named Connectors

```typescript
// Good: Named connectors
Connector.create({ name: 'openai-main', vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! } });
Connector.create({ name: 'openai-backup', vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_BACKUP_API_KEY! } });

const agent = Agent.create({ connector: 'openai-main', model: 'gpt-4.1' });

// Bad: Passing keys directly
const agent = Agent.create({
  connector: { vendor: Vendor.OpenAI, auth: { apiKey: '...' } },
  model: 'gpt-4.1'
});
```

#### 2. Handle Rate Limits

```typescript
import { retryWithBackoff } from '@everworker/oneringai';

const response = await retryWithBackoff(
  () => agent.run(input),
  {
    strategy: 'exponential',
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    multiplier: 2,
  },
  3
);
```

#### 3. Monitor Context Usage

```typescript
// Monitor context budget
const { budget } = await agent.context.prepare();
if (budget.utilizationPercent > 80) {
  console.warn(`Context at ${budget.utilizationPercent}%`);
}
```

#### 4. Use Circuit Breakers

```typescript
import { CircuitBreaker } from '@everworker/oneringai';

const breaker = new CircuitBreaker('my-breaker', {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
});

const safeTool: ToolFunction = {
  // ...
  execute: async (args) => {
    return await breaker.execute(() => externalAPI.call(args));
  },
};
```

#### 5. Secure OAuth Tokens

```typescript
// Always use encryption for OAuth tokens
const oauth = new OAuthManager({
  // ...
  storage: new FileStorage({
    directory: './tokens',
    encryptionKey: process.env.OAUTH_ENCRYPTION_KEY, // Required!
  }),
});
```

#### 6. Clean Up Resources (IDisposable Pattern)

The library uses the **IDisposable pattern** for proper resource cleanup. All major classes implement this pattern with:
- `destroy(): void` - Releases all resources (safe to call multiple times)
- `isDestroyed: boolean` - Check if already destroyed

```typescript
// Agent - cascades to AgentContextNextGen → ToolManager → CircuitBreakers
const agent = Agent.create({ connector: 'openai-main', model: 'gpt-4.1' });
agent.onCleanup(() => {
  console.log('Cleaning up...');
});
agent.destroy();  // Cleans up all child resources

// Standalone ToolManager
const toolManager = new ToolManager();
toolManager.destroy();  // Cleans up circuit breakers and listeners

// Check before use
if (!toolManager.isDestroyed) {
  await toolManager.execute('my_tool', args);
}
```

**Classes implementing IDisposable:**
- `Agent`
- `AgentContextNextGen`
- `ToolManager`
- `WorkingMemoryPluginNextGen`

### Performance Tips

1. **Use appropriate models:**
   - `gpt-5.6-luna`, `gemini-3.5-flash-lite`, or `claude-sonnet-5` for low-latency/high-throughput work
   - `gpt-5.6-terra`, `gemini-3.8-flash`, or `grok-4.6` for balanced production agents
   - `gpt-6-astra`, `gpt-5.5-pro`, or `claude-fable-5-1` for the most demanding reasoning and long-horizon work

2. **Leverage caching:**
   - Use provider-aware prompt caching where `getAdvancedCapabilities()` reports support
   - Keep stable prompt prefixes first and record actual cache-hit telemetry

3. **Use streaming:**
   - Better user experience
   - Lower perceived latency

4. **Manage context:**
   - The default `algorithmic` strategy (75% threshold) handles most use cases
   - Enable `workingMemory` for automatic tool result offloading
   - Register custom strategies via `StrategyRegistry` for specialized needs

5. **Batch requests:**
   - Use `getBatchProvider()` for supported offline workloads
   - Persist handles and reconcile ambiguous submissions instead of retrying blindly

---

## Examples

### Complete Examples

See the `examples/` directory:

```bash
# Basic examples
npm run example:text               # Simple text generation
npm run example:agent              # Basic agent with tools
npm run example:conversation       # Multi-turn conversation
npm run example:chat               # Interactive chat
npm run example:vision             # Image analysis
npm run example:providers          # Multi-provider comparison

# Tools and hooks
npm run example:json-tool          # JSON manipulation tool
npm run example:hooks              # Agent lifecycle hooks
npm run example:web                # Web research agent

# OAuth examples
npm run example:oauth              # OAuth demo
npm run example:oauth-registry     # OAuth registry
```

### Quick Recipes

#### Multi-Provider Setup

```typescript
// Configure all providers
Connector.create({ name: 'openai', vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! } });
Connector.create({ name: 'anthropic', vendor: Vendor.Anthropic,
  auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY! } });
Connector.create({ name: 'google', vendor: Vendor.Google,
  auth: { type: 'api_key', apiKey: process.env.GOOGLE_API_KEY! } });

// Create agents for each
const openaiAgent = Agent.create({ connector: 'openai', model: 'gpt-5.6-terra' });
const claudeAgent = Agent.create({ connector: 'anthropic', model: 'claude-opus-5' });
const geminiAgent = Agent.create({ connector: 'google', model: 'gemini-3.8-flash' });

// Compare responses
const [r1, r2, r3] = await Promise.all([
  openaiAgent.run(prompt),
  claudeAgent.run(prompt),
  geminiAgent.run(prompt),
]);
```

#### RAG (Retrieval-Augmented Generation)

```typescript
const searchTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'search_knowledge_base',
      description: 'Search internal knowledge base',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
  execute: async (args) => {
    // Search your vector database
    const results = await vectorDB.search(args.query);
    return { results };
  },
};

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [searchTool],
  instructions: `You are a helpful assistant with access to a knowledge base.
                 Always search the knowledge base before answering questions.`,
});

const response = await agent.run('What is our return policy?');
```

#### Research Agent with Memory

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [searchTool, scrapeWebTool],
  context: {
    features: { workingMemory: true },
  },
});

// Agent uses memory tools to store research findings
const response = await agent.run(`
  Research our top 5 competitors.
  For each competitor:
  1. Search for their information
  2. Scrape their website
  3. Store key findings in memory
  4. Create a comprehensive report
`);
```

---

## Agent Runtime (preview)

The Agent Runtime is a vendor-neutral surface for executing complete agent systems.
It sits above `Agent`: OneRingAI retains its context/tool loop, while Codex retains
its coding-agent loop, shell, workspace, and native thread. Drivers normalize both
into the same specifications, capabilities, sessions, runs, live events, and results.

This is the correct surface when a workflow needs to plug in a pre-built agent harness,
select its model and reasoning level, observe its autonomous work, and receive one
normalized result. It is deliberately separate from model-provider adapters.

### Choose the right agent surface

| Goal | Use | Why |
|---|---|---|
| Build a OneRingAI-native assistant with OneRingAI tools, context, memory, and persistence | `Agent.create()` | `Agent` owns the native OneRingAI loop and is the simplest direct API |
| Coordinate multiple OneRingAI-native agents | `createOrchestrator()` | Adds delegation and shared-workspace tools around regular `Agent` instances |
| Run interchangeable complete agent systems such as OneRingAI and Codex | `AgentRuntime` | Normalizes driver selection, sessions, policy, events, cancellation, and results without replacing native loops |

Do not implement Codex, Claude Agent SDK, or another complete harness as an
`ITextProvider`: those systems already own an agent loop and tool/session semantics.
They belong behind an `AgentDriver`. Likewise, use an execution backend—not a driver—to
choose whether work runs locally or in a future isolated server worker.

### Current implementation and roadmap

| Component | Status | Notes |
|---|---|---|
| Native OneRingAI driver | Implemented locally | Stored definition, registered binding, or factory source |
| OpenAI Codex TypeScript SDK driver | Implemented locally | Optional peer dependency; SDK-managed local CLI process |
| Live autonomous observation | Implemented locally | Messages, vendor-exposed reasoning, and driver-specific activity |
| Interactive approvals, user questions, and steering | Capability-defined, not implemented locally | Planned for drivers with a bidirectional native protocol, such as Codex App Server |
| Remote container/microVM execution | Designed, not implemented | Future execution backend with per-active-run isolation leases |
| Claude Agent SDK and other agent harnesses | Designed, not implemented | Add drivers without changing application lifecycle code |
| A2A interoperability | Designed, not implemented | External protocol adapter, not the internal worker protocol |

The local preview supports native OneRingAI agents and the OpenAI Codex TypeScript
SDK. Install the optional peer only when using the Codex driver:

```bash
npm install @openai/codex-sdk
```

The complete local example can run either backend through the same workflow:

```bash
npx tsx examples/agent-runtime-local.ts oneringai
npx tsx examples/agent-runtime-local.ts codex
```

### Create a local runtime

The generic API is published separately from the optional Codex driver:

```typescript
import { Agent } from '@everworker/oneringai';
import {
  AgentRuntime,
  LocalExecutionBackend,
  OneRingAIDriver,
  type AgentRun,
  type RuntimeAgentSpec,
}
  from '@everworker/oneringai/agent-runtime';
import { CodexSdkDriver }
  from '@everworker/oneringai/agent-runtime/codex';

const runtime = new AgentRuntime({
  backend: new LocalExecutionBackend({
    drivers: [
      new OneRingAIDriver({
        // This asserts that every supplied native Agent's tools and permission
        // pipeline enforce the runtime policy passed below.
        trustAgentPolicy: true,
        factories: {
          assistant: ({ context }) => Agent.create({
            connector: 'openai-main',
            model: 'gpt-5.3-codex',
            userId: context.userId,
          }),
        },
      }),
      new CodexSdkDriver(),
    ],
  }),
});
```

### Select an agent, model, and reasoning level

A OneRingAI source is a stored definition, registered binding, or factory. Its native
source owns connector and instructions. Model and reasoning selection use the same
generic fields as every other runtime driver:

```typescript
const oneRingSpec: RuntimeAgentSpec = {
  id: 'support-agent',
  driver: 'oneringai.agent',
  model: 'gpt-5.6-sol',
  reasoning: { effort: 'medium' },
  driverConfig: { source: { type: 'factory', name: 'assistant' } },
};
```

A Codex source uses a named OpenAI API-key connector, an active OpenAI model from the
registry, and an explicit local workspace:

```typescript
const codexSpec: RuntimeAgentSpec = {
  id: 'coding-agent',
  driver: 'openai.codex.sdk',
  connector: 'openai-main',
  model: 'gpt-5.6-sol',
  reasoning: { effort: 'medium' },
  instructions: 'Make focused changes and run relevant tests.',
  driverConfig: {
    skipGitRepoCheck: false,
    allowProjectConfig: false,
  },
};
```

Both local drivers fail closed on model-specific reasoning controls. The Codex driver
uses `modelReasoningEfforts`; the OneRingAI driver uses richer
`modelReasoningControls` entries because native agents may also support disabling
reasoning or fixed token budgets. New models require explicit verified metadata rather
than optimistic passthrough:

```typescript
const codexDriver = new CodexSdkDriver({
  modelReasoningEfforts: {
    'new-codex-model': ['low', 'medium', 'high'],
  },
});

const oneRingDriver = new OneRingAIDriver({
  trustAgentPolicy: true,
  modelReasoningControls: {
    'new-provider-model': {
      efforts: ['low', 'medium', 'high'],
      supportsDisabled: false,
      supportsBudgetTokens: true,
    },
  },
});
```

The bundled OneRingAI map covers GPT-6 Astra and GPT-5.6 Sol/Terra/Luna; the
Codex map covers GPT-5.6 Sol/Terra/Luna, and both retain GPT-5.3 Codex.
Unsupported efforts, disable requests, and token
budgets fail before an API call. Known models marked as non-reasoning reject reasoning
configuration in both drivers. For OneRingAI agents, model overrides also update the
managed context's model and registry-derived context limit; an explicit
`context.maxContextTokens` remains fixed.

Model and thinking controls are available both on the specification and per run. A
per-run value overrides the specification for that turn and requires the corresponding
`run.model_override` or `run.reasoning_override` capability:

```typescript
const agent = runtime.agent(codexSpec);

const session = await agent.openSession({
  context: { tenantId, userId },
  workspace: { type: 'local-directory', path: repositoryPath },
  policy: {
    filesystem: 'workspace-write',
    commands: 'sandboxed',
    sandboxNetwork: 'denied',
    providerWebSearch: 'denied',
    approvals: 'deny',
    limits: { wallTimeMs: 300_000, outputBytes: 256_000 },
  },
  observation: { mode: 'live', detail: 'reasoning' },
  controlMode: 'observe-only',
});

const run = await session.run('Implement the approved change.', {
  model: 'gpt-5.3-codex',
  reasoning: { effort: 'high' },
});

const renderEvents = async (activeRun: AgentRun) => {
  for await (const event of activeRun.events()) {
    // Forward every visible thought summary, message, plan, command/output,
    // file change, tool update, usage update, and terminal event to the UI.
    render(event);
  }
};

await renderEvents(run);
const result = await run.result;
console.log(result.configuration); // effective model and reasoning configuration
```

### Inputs and structured results

JSON Schema response formats and workspace image parts are also automatically
capability-gated as `run.structured_output` and `input.image`; callers do not need to
duplicate those requirements manually.

### Observation, autonomy, and control are separate

The runtime deliberately avoids one ambiguous “interactive mode” flag:

| Concern | Configuration | Current local support |
|---|---|---|
| Autonomous versus approval-gated execution | `policy.approvals` | Autonomous with `deny`; interactive approvals are unsupported |
| Live versus final-only observation | `observation.mode` | Both |
| Amount of visible activity | `observation.detail` | `status`, `activity`, or `reasoning` |
| Observe-only versus steerable control | `controlMode` | Observe-only; steering is capability-gated and currently unsupported |

The default observation is `{ mode: 'live', detail: 'reasoning' }`. Autonomous users
therefore see the agent working without having to approve or interfere. “Reasoning”
means every readable reasoning event exposed by the selected vendor/model; it does not
promise private chain-of-thought.

Use `activity` to stream messages, plans, commands, command output, file changes, and
tools without reasoning events. Use `status` or `final-only` when only essential/final
updates are wanted. Filtering affects delivery and retention, never native execution.

Representative event types include:

```text
run.started
agent.message.delta / agent.message.completed
reasoning.delta / reasoning.completed
plan.updated / agent.iteration.completed
command.started / command.output.delta / command.completed
file.change.started / file.changed
tool.started / tool.progress / tool.completed
usage.updated / diagnostic / run.finished
```

Both current local drivers report message `phase: 'unknown'`: their native streams do
not reliably distinguish an intermediate tool-producing message from the final answer.
Use `run.finished` and `run.result` for terminal state.

Events are sequence-numbered and retained in a bounded in-process journal. A client
can reconnect with `run.events({ afterSequence })` while that history remains. Event
consumption is optional: the backend pumps native events itself and `run.result`
settles even when nobody subscribes. Events are deeply cloned and frozen before
publication, so one UI subscriber cannot modify another subscriber's data or replay
history. OneRingAI structured-output runs remain on this streamed path and validate
the completed output against the requested schema.

### Capability inspection

Inspect before opening a session when a workflow has hard requirements:

```typescript
const capabilities = await agent.inspect({
  workspace: { type: 'local-directory', path: repositoryPath },
  policy,
  requiredCapabilities: [
    { id: 'event.live', minimum: 'native' },
    { id: 'event.reasoning' },
    { id: 'run.model_override' },
    { id: 'run.reasoning_override' },
  ],
});

console.log(capabilities.configuration);
```

Support is `native`, `emulated`, or `unsupported`. Unsupported requirements fail in
preflight instead of silently degrading. The current Codex SDK and OneRingAI drivers
both expose live model/reasoning-aware autonomous runs, but their event categories and
enforcement strength differ.

### Local and server boundaries

The Codex SDK driver launches an SDK-managed local CLI process; it does not call a
hosted Codex App Server. It uses a session-owned Codex home, minimal environment,
non-login shell policy, connector-secret filtering/redaction, `approvalPolicy:
'never'`, and the requested Codex sandbox. Repository `.codex/config.toml` is rejected
before every turn unless `allowProjectConfig: true` explicitly trusts it.

Codex App Server is a separate process that the host starts and supervises. It is a
future driver for richer bidirectional approvals, questions, and steering. It is not
needed merely to stream autonomous work; the SDK driver already publishes messages,
reasoning summaries, plans, commands/output, file changes, and tool activity.

The local backend is for trusted development and is not multi-tenant isolation. A
future server backend should keep this API but schedule an isolated container or
microVM lease per active run, optionally retaining warm session affinity for a short
TTL. A permanent VM per tenant/session is a deployment choice, not a runtime
requirement. Durable events/checkpoints, credential leasing, and A2A adapters remain
separate future phases.

Cancellation, timeout, and post-start driver failures attempt bounded native cleanup.
Synchronous driver cancellation errors are contained. If the native result and event
pump cannot both be confirmed terminal within the cleanup window, the run still
returns its normalized result, but the session fails and the local backend quarantines
that workspace lease until backend teardown; it never starts a second writer over
possibly live native work.

Always clean up sessions and the runtime:

```typescript
try {
  // open and run sessions
} finally {
  await session.destroy();
  await runtime.destroy();
}
```

See the [full design](./docs/designs/AGENT_RUNTIME.md) and runnable
[`agent-runtime-local.ts`](./examples/agent-runtime-local.ts) example.

## Support & Resources

- **GitHub:** https://github.com/aantich/oneringai
- **Issues:** https://github.com/aantich/oneringai/issues
- **Examples:** `/examples` directory in repo
- **TypeScript Docs:** Full IntelliSense support

---

## License

MIT License - see LICENSE file for details.

---

**Last Updated:** 2026-08-30
**Version:** 1.1.6
