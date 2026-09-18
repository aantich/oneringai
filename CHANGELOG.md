# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- OAuth authorization-code callbacks now return an exported `OAuthCallbackResult`
  with the provider's optional raw `idToken`. The result is forwarded through
  `OAuthManager` and `Connector`; ID tokens are not verified or persisted in token
  storage. Existing callers may ignore the result; explicit `Promise<void>`
  wrappers should await/discard it or adopt the new return type.

## [1.1.7] — 2026-09-04

### Added

- **Astra workflows in AMOS.** Added an `/astra` command for stored Responses
  continuations, in-band reasoning changes, async tool execution through the
  normal permission pipeline, live WebSocket steering, and safety-alert lookup.
- **September model catalog.** Added Claude Fable 5.1, invite-only Claude
  Mythos 5.1, and Gemini 3.8 Flash with current capabilities, context limits,
  reasoning efforts, processing tiers, lifecycle, and pricing metadata.

### Changed

- **Model-aware AMOS execution.** Fresh AMOS configurations default to GPT-6
  Astra, expose reasoning effort configuration, and omit unsupported sampling
  parameters while preserving existing users' selected model.
- **Current provider routing.** Gemini 3.8 Flash now uses Google's Interactions
  API by default. Grok 4.6 metadata now reflects its documented Responses and
  Chat Completions surfaces and supported reasoning efforts.

### Fixed

- **Registry lifecycle and pricing.** Corrected current Claude 5 release dates,
  pricing, preferred models, and retired-model replacements; retained Google's
  last explicitly documented `gemini-flash-latest` target; and recorded the
  announced deprecation and replacement for Grok Imagine Image Quality.

## [1.1.6] — 2026-09-04

### Added

- **GPT-6 Astra.** Added the limited-rollout flagship to the model registry,
  Agent Runtime reasoning controls, hosted-tool discovery, pricing metadata,
  and integration coverage.
- **Astra Responses extensions.** Added typed async function/custom tools and
  result continuations, persistent `configuration_update` input items,
  `compaction_trigger`, a connector-first Responses WebSocket session with
  mid-turn steering, and connector-first safety-alert retrieval.

### Changed

- **OpenAI SDK 7.10.** Updated the SDK baseline for Responses WebSocket,
  steering, configuration-update, async-tool, and safety-alert types. Astra
  requests now reject unsupported reasoning/sampling options and explicit
  Fast mode through the EU data-residency endpoint before inference.

### Fixed

- **Misalignment error classification.** OpenAI
  `misalignment_policy_violation` failures now map to a dedicated non-retryable
  error with request/response correlation instead of generic 403 auth failure;
  routine retries and provider circuit-breaker failures also stop for this error.
- **Astra continuation fidelity.** OpenAI compaction items now remain in direct
  response output order and direct streams emit normalized compaction events.
  Async continuations in the guide now resend their tools and instructions.
- **Astra request and steering validation.** Unknown Astra snapshots use the
  family capability fallback, configuration updates validate effort and
  single-agent constraints, incompatible async/programmatic/parallel requests
  fail before inference, and steering accepts only non-empty user input.

## [1.1.5] — 2026-08-31

### Fixed

- **Realtime WebRTC event buffering.** Parsed server events are no longer also
  retained in the pre-consumer raw-message buffer when an event listener is
  already attached, preventing active voice sessions from disconnecting after
  the pending-message limit is reached.
- **Realtime voice prompt caching.** Per-turn context synchronization now
  resends instructions and tools only when they actually change, preserving
  OpenAI prompt-cache reuse while still applying updated Agent context before
  the next response.

## [1.1.4] — 2026-08-31

### Added

- **Live Realtime voice-agent E2E coverage.** Added the opt-in
  `npm run test:realtime:e2e` path covering a real browser microphone fixture,
  WebRTC media, the server sideband Agent session, a local tool call, returned
  assistant audio/transcript, and provider-call release.

### Fixed

- **OpenAI WebRTC/SIP sideband handshake.** Sideband WebSockets now wait for
  the socket to open, send an initial `session.update`, and become connected
  only after `session.updated`; they no longer wait indefinitely for a
  `session.created` event that OpenAI does not replay for existing calls.
- **Acknowledged Agent-session readiness.** `OpenAIRealtimeAgentSession.connect()`
  now waits for OpenAI to acknowledge the configured session and uses a second
  acknowledged update as a barrier after replaying managed history. Rejected,
  aborted, timed-out, or transport-closed setup fails instead of exposing a
  prematurely ready session.
- **Bounded Realtime shutdown.** Active local tools receive a configurable
  drain deadline, overdue work cancels the Agent, late tool continuations and
  errors are suppressed after closure, and an already-closed OpenAI call makes
  `hangupCall()` succeed idempotently.
- **Bundler-safe WebSocket transport.** OpenAI Realtime, xAI speech, and Twilio
  now share a cached `ws` loader that forces the portable JavaScript masker,
  avoiding crashes when bundlers replace the optional native `bufferutil`
  dependency with a non-functional module stub.

## [1.1.3] — 2026-08-30

### Added

- **August 2026 model catalog.** Added Gemini 3.7 Flash, Gemini Omni 1.1 Flash,
  Gemini 3.5 Transcribe/Live, Grok 4.6, Grok Imagine Image 2.0, DeepSeek V4
  Flash Vision Experimental, Groq Whisper Large v3 Turbo, Codestral Embed,
  EmbeddingGemma, and All MiniLM.

### Changed

- **Current pricing and defaults.** Updated GPT-5.6 Sol promotional pricing,
  DeepSeek peak/off-peak rates, Groq Whisper pricing, Google/xAI media defaults,
  current provider routing, Agent Runtime reasoning maps, and downstream app,
  integration-test, and AMOS documentation.
- **Lifecycle metadata.** Retired elapsed OpenAI aliases, Google Imagen 4, and
  Groq Distil Whisper entries. Sora 2 and Sora 2 Pro remain callable but are
  marked deprecated from 2026-03-24 through the 2026-09-24 Videos API shutdown.

## [1.1.2] — 2026-08-30

Version 1.1.2 strengthens long-lived provider sessions, distributed Agent
packages, and host-managed OpenAI credentials. Existing connector-first Agent
and Agent Runtime applications remain source-compatible. Portable package peers
must upgrade together because the wire protocol moves from version 1 to 2.

### Added

- **Rotating host credentials.** Runtime-only `api_key_provider` connector auth
  resolves and validates a fresh API key for OpenAI text, image, audio, video,
  and embedding SDK requests, and once per Codex SDK session. Connector
  persistence rejects this host-local callback form.
- **Portable executable compatibility.** Protocol v2 fingerprints local tool
  implementations, requires explicit shared fingerprints for custom local
  tools, automatically fingerprints generated built-ins against runtime source,
  canonicalizes definitions and generated source hashes across JSON and host
  platforms, verifies remote definition fingerprints, and lets the receiving
  host supply authoritative per-tool permissions while retaining packaged
  permission metadata as information only. Dynamic prompt descriptions remain
  host-local presentation data. Version 1 and 2 peers require a coordinated
  rollout and cannot share a tool-server session.
- **Explicit semantic context rollover.** `Agent.rolloverContext()` and
  `AgentContextNextGen.rollover()` compact an older conversation prefix at a
  provider-session boundary while preserving recent turns, tool pairs, plugin
  state, and the append-only history journal. Agent-level rollover shares the
  normal execution lease, uses a tool-free configured-model summary by default,
  checkpoints configured session storage, reports detailed token/item counts,
  and emits `context:rolled_over` after an atomic commit.

### Changed

- **Portable package protocol v2.** `LocalToolResolver` now returns a
  `ResolvedLocalTool`; custom local exports provide a stable shared
  implementation ID through `toolImplementationFingerprint`, while generated
  built-ins can use `createResolvedLocalTool()`. Portable descriptors now carry
  `implementationFingerprint`, optional informational permission metadata, and
  canonical remote-definition validation. Protocol v1 and v2 peers reject one
  another by design.
- **Trusted receiving hosts own portable permissions.** Hydration requires the
  existing host Agent permission system and applies per-tool overrides only
  when a trusted `toolPermissionResolver` returns them. Package data never
  grants tool authority.
- **Runtime and dependency baseline.** The supported engine range is now
  Node.js `^22.13.0 || >=24.0.0`. Direct dependencies move to Google Gen AI
  2.19, MCP 1.30, OpenAI 7.8, glob 13, jsdom 29, officeparser 7.8, and ws 8.21;
  Vitest and its coverage provider move to 3.2.7. Repository overrides pin
  current patched transitive releases, and install-script allowlisting is
  explicit.

### Fixed

- **Stable cross-host tool compatibility.** Generated built-in hashes include
  normalized OneRingAI runtime and tool source, use platform-independent paths
  and line endings, and are regenerated with the tool registry. JSON-wire
  canonicalization prevents omitted and `undefined` optionals from producing
  different fingerprints; dynamic descriptions remain host-local, while
  callable schemas, blocking mode, and timeouts must match.
- **Consistent rotating-key use.** All OpenAI SDK-backed text and media
  providers use the validated runtime callback. The Codex SDK driver resolves
  connector tokens through `getToken()` and accepts `api_key_provider`, while
  non-OpenAI providers and connector persistence fail closed for that auth
  form.

### Migration notes

- Upgrade every Agent-package exporter, receiving host, and remote-tool server
  in one coordinated rollout. Do not mix protocol versions within a session.
- For a custom tool placed `local`, use the same stable implementation ID on
  both hosts with `createPortableToolImplementationFingerprint()` and return
  `{ tool, implementationFingerprint }` from `localToolResolver`.
- Treat `descriptor.permission` as display or transport metadata only. Resolve
  effective policy from trusted host state with `toolPermissionResolver`.
- End an active Realtime/external execution before calling
  `agent.rolloverContext()`. Supply a trusted `summarize` callback if the
  Agent's configured model cannot perform normal text generation.
- Upgrade Node.js 22 deployments to 22.13.0 or newer. Node.js 24 and later are
  supported; Node.js 23 is outside the declared range.

## [1.1.1] — 2026-08-28

### Added

- **Agent-aware Realtime voice sessions.** Added
  `OpenAIRealtimeAgentSession`, a transport-neutral layer that synchronizes
  `AgentContextNextGen` before turns, exposes cumulative modality usage, replays
  managed history, supports text/image turns, and warns before OpenAI's
  60-minute session limit.
- **Complete Realtime tool lifecycle.** Local functions now execute through the
  Agent hook/approval/permission/identity/timeout/event/metrics path, parallel
  results are committed as one context batch, and provider-hosted MCP approval
  requests fail closed unless an explicit handler approves them.
- **WebRTC SDP helper and audio backpressure.** `OpenAIRealtimeAPI` now exchanges
  SDP offers through `/v1/realtime/calls`; WebSocket sessions bound queued audio
  with a configurable high-water mark.
- **Distributed native-Agent packages.** Added versioned, data-only Agent
  packages, trusted-host hydration, local/remote tool placement, and a bounded,
  idempotent remote-tool protocol for desktop and browser execution.
- **Browser-safe Realtime peer.** Added the
  `@everworker/oneringai/realtime-browser` subpath for WebRTC media and Realtime
  data-channel events without importing the Node.js SDK surface.
- **Per-call Agent factories.** `VoiceBridge` can resolve a fresh asynchronous
  `Agent` for every call, enabling tenant-, user-, and session-scoped voice
  configuration without sharing execution state.

### Changed

- **Telephony uses the shared Agent-aware layer.** OpenAI `RealtimePipeline`
  refreshes dynamic context before each response and exposes usage/MCP approval
  handling while preserving PCMU streaming and interruption truncation.
- **WebRTC metadata without a breaking return change.** Existing
  `createWebRTCCall()` consumers continue to receive the SDP answer string;
  callers that also need OpenAI's call ID use
  `createWebRTCCallWithMetadata()` and receive `{ sdp, callId }`.

### Fixed

- **ESM package loading with MCP.** AJV and `ajv-formats` remain external to the
  ESM bundle, avoiding generated dynamic `require()` calls under Node.js ESM.
- **Realtime audio and lifecycle correctness.** Agent sessions now decode
  WebSocket output-audio deltas, preserve identical replies across turns,
  distinguish cancellation from normal and unexpected closure, and pass the
  current external input sequence to lifecycle hooks.
- **Atomic Agent execution ownership.** `run`, `stream`, async continuations,
  and external transports share one execution lease; parallel external tool
  admission now enforces `maxToolCalls` without double-counting active calls.
- **Generated API signatures.** The API documentation generator now slices at
  the declaration body instead of object-literal braces in parameters/defaults.
- **Portable wire and voice teardown validation.** Realtime session ending now
  has one published owner before synchronous state events fire. Portable
  packages and remote tool messages validate branch-specific DTOs, conversation
  content, zero-valued runtime controls, JSON wire values, unexpected fields,
  and UTF-8 byte limits. Package tools cannot overwrite trusted host tools, and
  remote results are bounded as well as arguments.
- **Bounded ordered Realtime attachment.** The browser peer and main-process
  channel transport retain creation and other early events until consumers
  attach, enforce count and byte limits, and fail closed on overflow instead of
  silently dropping an older event.
- **Shared asynchronous cleanup.** Concurrent remote tool-server closes and
  WebRTC `closeAndRelease()` calls await the same drain/provider-release work,
  so no caller returns while cleanup owned by another caller remains pending.
- **Runtime snapshot and thinking validation.** Trusted hydration overrides may
  contain callbacks and other host-local references without structured-clone
  failures, while enabled thinking configurations reject a zero token budget.

### Migration notes

- Portable packages describe executable state but grant no authority. Receiving
  hosts must continue to supply connector/model resolution, permissions,
  context/plugin policy, credentials, provider tools, and data-handling policy.
- Code that needs a Realtime call ID should opt into
  `createWebRTCCallWithMetadata()`; no migration is required for existing
  `createWebRTCCall()` SDP-string consumers.

## [1.1.0] — 2026-08-24

Version 1.1.0 introduces OneRingAI's preview Agent Runtime: one generic,
observable execution layer for complete native OneRingAI and OpenAI Codex SDK
agents. It also ships the dedicated current DeepSeek provider accumulated since
1.0.1. The release is additive; existing `Agent` applications continue to use
the same connector-first API.

### Highlights

- **Run complete agent systems through one API.** Applications can select a
  native OneRingAI agent or Codex SDK agent, inspect capabilities, open a
  session, stream autonomous work, cancel it, and consume one normalized result
  without replacing either driver's native agent loop.
- **Autonomous does not mean opaque.** Live observation is independent from
  approvals and steering. The runtime publishes every driver-available message,
  reasoning summary, tool/command/file update, usage event, and terminal state
  selected by the observation policy.
- **Fail closed at the native boundary.** Model/reasoning combinations,
  structured output, image input, workspace access, policy, and optional
  interaction features are capability-gated. Unconfirmed native termination
  fails the session and quarantines its workspace lease.
- **Ready for more drivers and isolated placement.** Driver and execution
  backend interfaces are separate, leaving room for Claude and other agent SDKs,
  Codex App Server, and remote container/microVM workers without changing the
  application-facing lifecycle.

### Added

- **Vendor-neutral Agent Runtime subpath.** Added
  `@everworker/oneringai/agent-runtime` with immutable runtime specifications,
  capability negotiation, trusted context, explicit execution policy, local
  workspaces, sessions, runs, structured results, typed errors, cancellation,
  and lifecycle ownership.
- **Native OneRingAI driver.** Added stored-definition, registered-binding, and
  factory sources while preserving OneRingAI's connector ownership, context
  plugins, permission pipeline, and single shared `ToolManager`.
- **Optional Codex SDK driver.** Added
  `@everworker/oneringai/agent-runtime/codex` as a lazy optional peer integration
  with native threads, structured output, image input, workspace sandboxing,
  isolated child environments, connector-derived API authentication, and
  project-configuration safeguards.
- **Model and thinking selection.** Added model and reasoning configuration at
  specification and per-run scope. Both local drivers validate explicit effort
  levels against verified model maps rather than passing unknown combinations
  optimistically.
- **Live event journal.** Added bounded sequence-numbered events, late-subscriber
  replay, multiple observers, observation detail levels, immutable event data,
  and completion that never depends on an application consuming the stream.
- **Structured result enforcement.** Added JSON Schema validation with explicit
  native/emulated enforcement reporting and automatic capability gates for
  structured output and workspace image inputs.
- **Agent Runtime documentation and example.** Added a prominent README
  overview, a detailed User Guide chapter, the architectural/server roadmap,
  agent-facing documentation routing, and a runnable local OneRingAI/Codex
  example.
- **Dedicated DeepSeek provider.** Added current V4 Flash/Pro registry records,
  Chat Completions and Responses transports, streaming, reasoning replay for
  tool loops, structured output, native web search, model listing, FIM,
  balance lookup, and strict beta tool schemas.
- **DeepSeek hosted-provider presets.** Added canonical model mapping and
  host-specific limits for OpenRouter, Together, Fireworks, DeepInfra, NVIDIA
  NIM, Azure Foundry, and custom OpenAI-compatible deployments.

### Changed

- **Agent model changes now synchronize managed context.** `Agent.setModel()`
  updates context model metadata and registry-derived context limits while
  preserving an explicitly configured token limit.
- **DeepSeek has a dedicated adapter.** DeepSeek no longer inherits the OpenAI
  Responses-only implementation; retired `deepseek-chat` and
  `deepseek-reasoner` records point to current migration targets.
- **npm metadata highlights complete-agent execution.** The package description,
  keywords, exports, optional peer metadata, bundled docs, and example scripts
  now expose the Agent Runtime as a first-class library capability.

### Fixed

- **Native cancellation and workspace reuse.** Synchronous cancellation errors,
  cancellation during startup, timeout, and post-start event-pump failures are
  contained. A workspace is not released until native result and event
  termination are both confirmed.
- **Event and capability correctness.** Intermediate OneRingAI messages no
  longer claim to be final, unsupported reasoning controls fail before an API
  call, and structured/image features cannot bypass capability preflight.
- **Secret and configuration boundaries.** Codex command environments filter
  connector credentials, event/error redaction handles streamed fragments, and
  repository Codex configuration is rejected by default and rechecked each turn.
- **DeepSeek embeddings boundary.** Removed DeepSeek from the embedding-provider
  factory because its first-party API does not expose an embeddings endpoint.

## [1.0.1] — 2026-08-09

Patch release focused on making OneRingAI easier to discover, learn, and use
from both coding agents and runnable reference applications. It also refreshes
AMOS against the 1.0 APIs and hardens the npm release path.

### Added

- **A complete coding-agent guide.** `AGENTS.md` now gives OpenAI Codex,
  Claude Code, and custom coding agents a package-native map of the
  connector-first architecture, agent lifecycle, tools, context plugins,
  memory, multimodal APIs, MCP, orchestration, and the most important safety
  invariants. `CLAUDE.md` provides a lightweight compatibility entry point.
- **Connector and tool catalog.** Added `docs/CONNECTOR_TOOL_CATALOG.md` with
  the built-in tool inventory, default connector-provided tools, capability
  requirements, and discovery examples.
- **Runnable examples index.** Added `examples/README.md`, an examples-specific
  TypeScript configuration, and a local MCP demo server. Existing examples
  were updated to the connector-first APIs and current model registry.
- **Agent onboarding in the README.** The main README now explains how a coding
  agent can load the bundled guide directly from the installed npm package.

### Changed

- **AMOS terminal demo refreshed.** Updated AMOS to the current Agent,
  Connector, context, model, prompt, tool, permission, and session APIs;
  modernized its Node.js 22 build; and routed web search and scraping through
  Serper and ZenRows connectors.
- **Documentation audited end to end.** Expanded the README and User Guide,
  promoted the memory system and context-plugin architecture, documented
  tool discovery and connector capabilities, and corrected stale examples and
  API descriptions throughout the memory documentation.
- **Agent documentation now ships on npm.** The package includes the agent
  guides, API reference, User Guide, connector/tool catalog, and the focused
  memory, model-registry, and signal-ingestion documentation.

### Fixed

- **Provider configuration agent history.** Switched the helper to explicit
  direct-run history handling, added lifecycle cleanup, and selected sensible
  vendor-specific default models.
- **Deterministic generated registries.** Removed volatile generation
  timestamps so builds no longer dirty an otherwise clean release checkout.
- **Release verification.** Patch releases now create the version commit and
  Git tag through `npm version`, push tags with the commit, and verify that the
  expected clean tag points at `HEAD` before publishing.

## [1.0.0] — 2026-08-08

Version 1.0.0 establishes the supported production contract for OneRingAI's
connector-first, multi-vendor inference layer. It aligns the model and media
registries with the current OpenAI, Anthropic, Google, and xAI APIs; promotes
Realtime voice to a first-class capability; and introduces an explicit,
source-backed registry lifecycle schema suitable for model routing, migration,
and cost accounting.

### Highlights

- **A current multi-vendor foundation.** Text, reasoning, vision, image, video,
  embeddings, TTS, STT, and realtime voice now use audited current model
  families and provider-native API contracts.
- **Production realtime voice.** OpenAI voice agents, transcription,
  translation, WebRTC credentials, SIP controls, and Twilio media bridging are
  supported alongside xAI Voice Agent sessions, browser credentials, SIP call
  control, resumption, and binary audio.
- **Registry data applications can trust.** Schema v2 separates callability
  from lifecycle, resolves floating aliases without duplicate records, records
  endpoint and replacement metadata, and models current billing dimensions.
- **Verified against live services.** The release was exercised with real
  OpenAI, Anthropic, Google, and xAI credentials in addition to the full unit,
  type, lint, and distributable-build suites.

### Breaking changes and migration

1. **Node.js 22 is now required.** The package `engines` field and main build
   target moved from Node.js 18 to Node.js 22. Upgrade the runtime used by
   applications, CI, containers, and serverless deployments before installing
   1.0.0.
2. **Registry token limits are nullable.** `features.input.tokens` and
   `features.output.tokens` are now `number | null`. `null` means the vendor
   does not publish a token window for that duration- or message-priced model;
   it no longer means zero. Narrow explicitly or call
   `resolveMaxContextTokens(model, fallback)` when a number is required.
3. **Lifecycle and callability are separate.** `isActive` means a model remains
   callable. Use `lifecycle` to distinguish `preview`, `active`, `legacy`,
   `deprecated`, and `retired`. A deprecated model may remain active until its
   `retirementDate`; use `replacementModel` and the `getDeprecated*Models()`
   helpers to drive migrations.
4. **Aliases resolve through helpers, not direct indexing.** For example,
   `getModelInfo('gpt-5.6')` resolves to `gpt-5.6-sol`, while
   `MODEL_REGISTRY['gpt-5.6']` remains undefined. Persist canonical `name`
   values when stable identity matters.
5. **Gemini 3.5+ defaults to Google Interactions.** Applications that inspect
   raw Google requests/responses or depend on `generateContent` wire behavior
   must migrate to the `steps`/`step.delta` contract or temporarily set
   `vendorOptions.api = 'generateContent'`. Set `api = 'interactions'` to force
   the new path on another compatible model.
6. **Current provider SDKs are the compatibility baseline.** OpenAI 7.4,
   Anthropic 0.116, and Google Gen AI 2.16 are used by the built-in adapters.
   Custom wrappers that depend on SDK-internal request or response types should
   be recompiled and retested.
7. **Realtime configuration follows the current GA schema.** New code should
   use `gpt-realtime-2.1`, nested `session.audio.input/output`, current
   `response.output_*` events, `intent=transcription` for transcription, and the
   dedicated translation endpoint. Legacy realtime registry entries remain for
   discovery but are inactive.

The connector-first `Connector.create()`/`Agent.create()` workflow, canonical
registry keys, and existing positional cost-helper calls remain supported.
Media cost helpers accept richer usage objects without invalidating their
previous signatures. See the README's 1.0 migration summary, the User Guide's
complete upgrade checklist, and `docs/MODEL_REGISTRY_AUDIT.md` for the audited
before/after matrix.

### Added

- **Model registry schema v2 and full four-vendor audit.** Added
  `MODEL_REGISTRY_SCHEMA_VERSION`, lifecycle/availability states, aliases,
  snapshots, normalized endpoints, retirement/replacement metadata, preferred
  choices, source tracking, and modality-aware pricing. Alias-aware lookup and
  `getDeprecated*Models()` helpers apply consistently across text, image, video,
  TTS, STT, and embedding registries.
- **Current OpenAI, Anthropic, Google, and xAI models.** Registered GPT-5.6
  Sol/Terra/Luna, GPT-5.5 Pro, Claude Opus/Mythos/Fable 5, Gemini 3.6/3.5,
  Grok 4.5/4.3/Build, GPT Image 2, current Gemini image/TTS/Veo/Omni and
  embedding models, current Grok image/video, and current OpenAI/xAI speech and
  realtime voice models with audited limits, lifecycle, features, and pricing.
- **xAI audio and realtime voice.** Added native REST/WebSocket TTS, dynamic
  voice discovery, REST/WebSocket STT with typed streaming events, Smart Turn,
  keyterms, diarization and multichannel controls, plus xAI Realtime browser
  credentials, resumption, SIP refer/hangup, and JSON/binary audio transport.
- **Google Interactions API.** Gemini 3.5+ now supports the GA `steps` response
  schema and `step.delta` streaming protocol, with tools, reasoning, structured
  output, usage conversion, and previous-interaction continuity.

- **Complete OpenAI Realtime API support.** New connector-first
  `OpenAIRealtimeSession` and `OpenAIRealtimeAPI` surfaces support GA server
  WebSockets, short-lived WebRTC client secrets, SIP accept/reject/refer/hangup,
  standard voice-agent sessions, dedicated realtime transcription, and continuous
  speech translation. The raw evolving event stream remains available alongside
  helpers for text, images, audio buffers, response lifecycle, truncation, and
  graceful translation shutdown.
- **Current realtime model registry.** Added `gpt-realtime-2.1` (preferred),
  `gpt-realtime-2.1-mini`, `gpt-realtime-2`, `gpt-realtime-translate`,
  `gpt-live-transcribe`, and `gpt-realtime-whisper`, including multimodal
  capability metadata and modality-aware or duration-aware cost calculation.
- **Production realtime telephony.** `VoiceBridge`'s realtime pipeline now uses
  the GA client with native PCMU audio, server or semantic VAD, optional local
  VAD, noise reduction, barge-in cancellation and audio truncation, streaming
  transcripts, local `ToolManager` execution, remote MCP tools, stored prompts,
  tracing, reasoning controls, and retention-ratio truncation.

### Changed

- **Current SDK/runtime baseline.** Upgraded `openai` to 7.4,
  `@anthropic-ai/sdk` to 0.116, and `@google/genai` to 2.16. The package and
  build target now require Node.js 22 or newer.
- **Provider defaults follow current vendor APIs.** Gemini 3.5+ selects
  Interactions by default (`vendorOptions.api = 'generateContent'` opts out),
  OpenAI Responses accepts current reasoning/service/cache options, Anthropic
  supports adaptive effort and fast mode, and xAI media providers use their
  dedicated native contracts.
- **High-level media defaults are lifecycle-aware.** `ImageGeneration` now
  selects GPT Image 2, Gemini 3.1 Flash Image, or Grok Imagine Image Quality
  instead of retired generation/editing models. Google `Embeddings` now
  defaults to Gemini Embedding 2, exposes task/vendor controls, and adds
  `embedMultimodal()` for text, image, audio, video, and document parts.
  Image generation now forwards normalized aspect ratio, current quality
  values, and vendor-specific controls; image edits and video extensions no
  longer require a redundant `model` when the vendor default is desired.
- **Cost helpers preserve old calls and accept current billing dimensions.**
  Text cost calculation supports long-context and processing tiers; media
  helpers support resolution, duration, REST-vs-streaming, image tokens, and
  multimodal embedding usage. Unknown voice-model token windows are now `null`
  instead of a synthetic zero.

- **Realtime defaults and events use the GA contract.** The preferred default is
  `gpt-realtime-2.1`; output configuration lives under `session.audio.output`,
  current `response.output_*` events are handled, transcription connects with
  `intent=transcription`, and translation uses its dedicated endpoint and event
  namespace. Legacy `gpt-realtime` and `gpt-realtime-mini` registry entries remain
  available but are marked inactive.

### Fixed

- **Registry/API drift.** Retired preview identifiers no longer appear as
  current recommendations, floating aliases resolve without duplicate records,
  Grok Build advertises its documented image input, and registry feature tests
  now respect lifecycle rather than hardcoded historical counts.
- **xAI wire correctness.** TTS handles the documented JSON/base64 response and
  raw-audio responses defensively, sends `text.delta.delta`, and detects early
  WebSocket closure. STT waits for `transcript.created`, streams raw binary
  frames, maps interim/final events, waits for one `transcript.done` per channel,
  and uses the distinct streaming rate. Realtime sessions now choose xAI's
  WebSocket host when a Grok connector does not specify a custom `baseURL`;
  voice/VAD use xAI's session-root fields and transcription uses
  `language_hint`.
- **Google Interactions continuity and ordering.** Interactions are stored by
  default so `previous_interaction_id` is usable, `runDirect()` and
  `streamDirect()` expose it as `previousResponseId`, explicit `store: false`
  remains available, and mixed text/thought/tool history retains source order.
- **Google Interactions stream termination.** Streaming now consumes
  `interaction.status_update`, every terminal `interaction.completed` status,
  and SSE `error` events. Cancelled/failed streams finish as `failed`,
  `budget_exceeded` finishes as `incomplete`, and a truncated stream without a
  terminal event no longer defaults to success.
- **Google native image normalization.** Public square sizes now map to
  Gemini's `512`/`1K`/`2K`/`4K` values, `auto` omits the resolution, edit input
  carries its detected MIME type, and `n` uses bounded request fan-out because
  current native models reject multiple `candidateCount` values.
- **Compressed file transcription.** `SpeechToText.transcribeFile()` preserves
  the source path so providers retain its format metadata; Google and xAI MIME
  inference now includes FLAC, AAC, MP4/M4A, and existing MP3/WebM/Ogg/WAV paths.
- **Raw-audio transcription metadata.** Batch `STTOptions` now exposes
  `encoding` and `sampleRate`. `TextPipeline` identifies Twilio's decoded PCM as
  8 kHz, while Google, xAI, and OpenAI preserve self-describing containers and
  correctly wrap or label headerless PCM instead of assuming an incompatible
  WAV or 16 kHz stream.
- **Google Interactions tool and media requests.** Named function choices now
  use `allowed_tools`; Gemini Omni fetches URL source images, preserves PNG/JPEG
  MIME types, and sends duration in `response_format`; multimodal embeddings
  fetch arbitrary HTTP(S) media inline instead of misusing Google-hosted
  `fileData` references.
- **Bounded Google embedding media downloads.** External HTTP(S) inputs now use
  an abortable streaming reader with a 30-second default timeout,
  `Content-Length` preflight, a 100 MB aggregate inline budget, and Google's
  50 MB PDF ceiling. Chunked responses are cancelled when they cross the
  remaining budget instead of being fully buffered first. Operators may tune
  `vendorOptions.mediaDownloadTimeoutMs` without weakening provider limits.
- **Google named-tool parity.** The legacy `generateContent` compatibility path
  now maps a named `tool_choice` to `ANY` plus `allowedFunctionNames`, matching
  the strict named-function behavior already implemented for Interactions.
- **Media MIME and translation normalization.** Optional multimodal-embedding
  MIME types are inferred from common image/audio/video/document signatures and
  path extensions, including JPEG, MP3, and QuickTime MOV. AAC ADTS detection
  covers both CRC-protected (`F0`/`F8`) and unprotected (`F1`/`F9`) headers
  before the broader MP3 sync test, and `SpeechToText.translate()` now
  forwards configured or per-call source-language hints.
- **Gemini transcription contract.** Native Google STT now consumes normalized
  language, timestamp, vocabulary, and diarization options, strips live
  timestamp markers, returns normalized segments, and explicitly rejects
  unsupported output formats. Registry metadata advertises the reliably
  observable segment granularity rather than unsupported word-level results.
- **xAI option validation.** Realtime sessions reject OpenAI-only
  `semantic_vad` before connecting, and xAI TTS metadata now accepts every
  documented streaming-latency level from 0 through 2.
- **Provider-specific Realtime PCM types.** `OpenAIRealtimeAudioFormat` now
  accepts only OpenAI's required 24 kHz PCM rate and is guarded at runtime.
  `GrokRealtimeSession`/`GrokRealtimeAudioFormat` expose xAI's complete
  documented set: 8, 16, 22.05, 24, 32, 44.1, and 48 kHz.
- **xAI TTS response metadata.** Buffered synthesis maps the response
  `Content-Type` or JSON `content_type` back to `TTSResponse.format`, including
  when `vendorOptions.output_format` overrides the normalized caller default.
- **OpenAI explicit-cache normalization.** GPT-5.6+ content breakpoints now use
  the documented `{ mode: 'explicit' }` object and are emitted only after the
  model/cache policy passes normalization. Older, unsupported, or cache-off
  calls cannot leak `prompt_cache_breakpoint` into Responses requests. The
  documented implicit policy remains composable with caller-marked content;
  request mode `explicit` disables only OpenAI's automatic breakpoint.
- **Anthropic request normalization.** Arbitrary shared metadata is narrowed to
  the Messages API's supported `{ user_id }` shape. A disabled normalized
  thinking configuration no longer emits its nested effort, while explicit
  `vendorOptions.effort` remains available because Anthropic defines effort as
  independent of thinking blocks.
- **Partial image-cost accounting.** Supplying text/input token usage no longer
  drops registry per-image output pricing. Per-image output is replaced only
  when actual `imageOutputTokens` are available, preventing severe
  underestimates for mixed partial usage.
- **Non-PCM WAV correctness.** Raw μ-law and A-law transcription inputs now use
  an 18-byte `WAVEFORMATEX` chunk with the required zero `cbSize`; PCM retains
  its standard 16-byte `fmt` chunk.
- **Realtime update validation.** OpenAI's 24 kHz PCM assertion now runs on
  every `updateSession()` as well as initial configuration. The typed xAI
  facade accepts its documented wider PCM range for initial and later updates.
- **Embedding data-URI hardening.** Gemini Embedding media now rejects malformed
  base64, preflights decoded size before allocation, and transmits canonical
  base64, so invalid characters cannot bypass the aggregate media budget.

- **Realtime transport and schema correctness.** REST helpers now resolve absolute
  connector URLs. Translation WebSocket updates omit client-secret-only fields,
  translation audio uses only supported configuration, and transcription selects
  its model in the nested session configuration rather than the WebSocket query.
- **Anthropic structured-output schema portability.** Native JSON schemas now pass through the
  official Anthropic SDK transformer before becoming `output_config.format.schema`. Unsupported
  grammar constraints such as `minItems > 1`, `maxItems`, string lengths, and numeric bounds move
  into descriptions instead of causing provider 400 errors; the caller's original schema is not
  mutated and remains available for host-side validation.

### Documentation

- **Vendor audit and migration guide.** README and User Guide now describe
  current text/media models, schema-v2 compatibility, Google Interactions,
  xAI TTS/STT and realtime voice, binary audio, and current cost APIs. Added
  `docs/MODEL_REGISTRY_AUDIT.md` with the pre-implementation gap report,
  implemented status, supported boundaries, migration notes, and official
  source links. Regenerated the public API reference for all new exports.
- **Major-release documentation.** Added a complete Node/runtime, registry-v2,
  alias/lifecycle, Google Interactions, Realtime, media-default, and validation
  upgrade checklist. Current image, video, voice, speech, embedding, and model
  selection examples replace retired lead examples throughout the README and
  User Guide.

- **Realtime API documentation is now end-to-end.** The README highlights and
  links to a dedicated User Guide chapter covering voice agents, realtime
  transcription, realtime translation, WebSocket/WebRTC, SIP controls,
  `VoiceBridge`, tools and MCP, VAD and interruption handling, events, costs,
  security, and production guidance. A runnable server-side example is included.

### Validation

- Seven live Realtime integration tests pass with the OpenAI API, covering native
  audio, text output, `gpt-realtime-2.1`, `gpt-realtime-2.1-mini`,
  `gpt-realtime-2`, both streaming transcription models, continuous translation,
  and standard/translation client secrets. Thirteen additional live smoke tests
  pass for GPT-5.6, Claude 5, Google Interactions and stored continuity, named
  Gemini tool selection on both Interactions and `generateContent`, native
  multi-image generation, bounded external-media
  embedding, Omni image-to-video duration, raw 8 kHz Google/xAI transcription,
  Grok 4.5, xAI TTS latency level 2, and an acknowledged 32 kHz PCM xAI Voice
  Agent session update. Strict typecheck, ESLint, the distributable build, and
  all 6,381 unit tests across 284 files also pass.

## [0.11.0] — 2026-07-24

Version 0.11.0 introduces a provider-neutral advanced inference layer for production agent
workloads and expands the connector catalog to 50 vendors. Applications can now request prompt
caching, submit durable text batches, use provider-hosted tools, discover executable capabilities,
and account for advanced token usage without embedding provider-specific request contracts in host
code.

### Highlights

- **One contract across OpenAI, Anthropic, and Google.** Advanced options are available on normal,
  direct, streaming, and low-level batch paths, with conservative provider/model capability checks
  at runtime.
- **Explicit trust boundaries.** Provider caching, retained batch data, provider-hosted tools, and
  third-party remote MCP calls each require the corresponding `dataHandling` authorization.
- **Durable batch workflows.** Hosts own persisted batch handles, polling, cancellation, partial
  results, and recovery from ambiguous submission outcomes; agent-created batch facades preserve
  the agent's `userId` and scoped connector registry.
- **Actionable usage economics.** Responses and execution metrics retain cache reads/writes,
  reasoning tokens, native-tool counts, service tier, and processing mode. Cost estimation handles
  mixed cached input, Anthropic cache-write TTL multipliers, and supported providers' 50% batch
  token discount.

### Added

- **Advanced inference contracts.** Provider-neutral prompt caching, executable model/provider
  capability discovery, detailed cache/reasoning/native-tool usage, and host data-handling policy
  are available on normal, direct, and streaming Agent calls. New public contracts include
  `PromptCachePolicy`, `AdvancedTextCapabilities`, `DataHandlingPolicy`, `NativeToolRequest`, the
  asynchronous batch types, and `TokenUsage` for hosts that persist detailed telemetry.
- **Asynchronous text batches for Anthropic, OpenAI, and Google.** One lifecycle covers submit,
  status, cancellation, and correlated partial results through `agent.getBatchProvider()`.
  `customId` correlation is preserved for successes and item-level failures. Ambiguous submissions
  throw `ProviderAmbiguousOperationError` with recovery metadata; SDK retries are disabled at the
  non-idempotent creation boundary so paid submissions are never automatically repeated.
- **Provider-hosted tools.** Typed web search/fetch, code execution, file search, and remote MCP
  requests are mapped per provider and kept distinct from client-executed `ToolFunction`s. Remote
  MCP credentials remain connector-first and are resolved through the agent's scoped registry.

- **Five new connector vendor templates (50 vendors total, 54 logos).** Each ships a template, a `Services.ts` service definition (auto-detection + generic `<connector>_api` tool), and a logo:
  - **Cal.com** (`cal-com`, productivity) — API v1 key auth via the `apiKey` query parameter (base `https://api.cal.com/v1`); notes cover switching to v2 (`cal-api-version` header). Official simple-icons logo.
  - **Calendly** (`calendly`, productivity) — Personal Access Token (Bearer) **and** OAuth 2.0 authorization-code with PKCE (`auth.calendly.com`, auto-refresh). Official simple-icons logo.
  - **HeyReach** (`heyreach`, communication) — LinkedIn sequencing; API key via the `X-API-KEY` header (no scheme prefix), base `https://api.heyreach.io/api/public`.
  - **EmailBison** (`emailbison`, email) — cold-email sequencing; Bearer token. Per-instance deployment, so `baseURL` **must** be overridden with your instance domain (e.g. `https://acme.emailbison.com/api`).
  - **Clay** (`clay`, other) — best-effort Bearer template for HTTP calls + per-table webhook ingestion; Clay is MCP-first, so prefer configuring it via `MCPRegistry` for richer agentic use (documented in the template `notes`).
  - Functionality is delivered through the generic authenticated `<connector>_api` tool (same model as HubSpot and other API-key vendors) — no service-specific tool factories added. HeyReach/EmailBison/Clay use branded placeholder logos (no official simple-icon exists).

### Changed

- **Anthropic structured output is model-gated and native where supported.** Current Claude 4.5+
  families use `output_config.format`; older models retain the safe prompt/repair fallback. Returned
  responses report whether structured output was enforced natively, by prompt, or by repair. When
  tools and a non-composable structured-output path are combined, `run()` performs a bounded final
  tool-free formatting pass without suppressing the agent's earlier tool work.
- **Token cost estimation supports mixed cached input and batch pricing.** Cache-hit, cache-write,
  reasoning, service-tier, and provider-native tool counters are retained through response and Agent
  metrics. Anthropic input usage is normalized to total processed input, and short/extended cache
  writes use their provider pricing multipliers.
- **Iteration history is reproducible.** Agent iteration records retain the effective inference
  options used for each model call, including structured output, cache policy, native tools, and
  data-handling controls; repair and wrap-up calls contribute to aggregate metrics.

### Fixed

- **Ordinary final Agent responses now contribute to execution metrics.** Previously the no-tool
  exit path skipped iteration accounting, causing successful one-turn runs to report zero tokens;
  normal, tool, suspension, and max-iteration wrap-up calls are now consistently recorded.
- **Advanced inference edge cases.** Scoped connector registries now govern remote MCP credentials;
  OpenAI batch output and error files are both consumed; structured-output repair calls contribute
  to metrics; max-iteration wrap-ups retain per-run inference policy; and provider capability
  checks are model- and tool-composition-aware. Capability, policy, URL, and schema checks now run
  before remote-MCP token resolution or a paid batch boundary; low-level/batch structured-output
  requests use the same native-vs-prompt normalization as Agent calls.
- **Batch and MCP safety.** Agent batch surfaces now preserve `userId` and scoped connector identity;
  Anthropic remote-MCP batches use the beta batch header correctly; OpenAI no longer advertises an
  unimplemented host-approval continuation and normalizes executable MCP calls to no-approval mode.
- **Usage normalization.** Anthropic cache-read and cache-creation tokens are included in total
  processed input without double-counting, reasoning telemetry survives provider conversion, and
  cache-write pricing uses the appropriate short or extended TTL multiplier.

### Upgrade and operational notes

- **Advanced data movement is opt-in.** Set only the required `dataHandling` flags. A cache mode of
  `off` prevents OneRingAI from requesting cache controls but cannot disable provider-implicit
  caching; enforce stronger guarantees through provider account policy.
- **Persist batch handles before returning control.** Batch creation is non-idempotent. On
  `ProviderAmbiguousOperationError`, reconcile the supplied recovery metadata with provider-side
  jobs instead of blindly submitting the batch again.
- **OpenAI remote MCP approval is fail-closed.** `requireApproval: 'always'` is rejected because the
  normalized adapter does not expose a host continuation for approval. Omitted approval is
  normalized to `never`; third-party data authorization is still mandatory.
- **Cost input semantics are now total processed input.** For Anthropic, `usage.input_tokens`
  includes uncached input, cache reads, and cache creation. Pass the detailed cache counters to
  `calculateCost()` so each portion receives the correct rate.

### Documentation

- **Advanced inference documentation now lives in `README.md` and `USER_GUIDE.md`.** Both
  cover executable capability discovery, prompt-cache semantics, asynchronous batch recovery,
  provider-hosted tool security, data-handling policy, detailed usage/cost telemetry, structured
  output interaction, troubleshooting, and production checklists.
- **Public and internal API references were regenerated** for the new contracts and provider
  surfaces. `USER_GUIDE.md` is included in the npm package, and this release also begins packaging
  `CHANGELOG.md` alongside the README and license.

### Validation

- Build, strict TypeScript checking, ESLint, and the complete unit suite pass for the release.
- Advanced-inference coverage includes provider conversion, capability gating, policy validation,
  batch lifecycle/recovery, native-tool mapping, structured-output fallback, telemetry, cost
  estimation, streaming, and Agent iteration accounting.

## [0.10.3] — 2026-07-06

### Documentation

- **`README.md` and `USER_GUIDE.md` fully re-audited against the current codebase and brought up to date.** Every section was verified against `src/` and all confirmed discrepancies were fixed — no API or behavior changes, docs only. Highlights:
  - **Model registry**: corrected "Available Models" (OpenAI 40 / Anthropic 13 / Google 10 / Grok 5; 68 active total) and removed nonexistent ids used in examples (`gpt-4-vision`, `gpt-4-turbo`, `veo-3.0-generate-001`, `gemini-tts`, `gpt-5.2-instant`); deprecated `dall-e-3` lead examples → `gpt-image-1.5`; fixed video/image prices and `calculateCost` outputs.
  - **API shapes**: current 5-tool orchestrator set (`assign_turn`, `delegate_interactive`, `send_message`, `list_agents`, `destroy_agent`); the 12 `memory_*` tools (6 read + 6 write); store IDs `notes`/`whiteboard` (not `memory`/`context`); snake_case plugin registry keys (`working_memory`, `in_context_memory`, `persistent_instructions`); accurate `ToolManager` / `AgentContextNextGen` / `CircuitBreaker` / `retryWithBackoff` / `logger` / `metrics` / `RoutineDefinition` signatures and event names; `Agent.create({ instructions })` (not `systemPrompt`); array-wrapped multimodal `agent.run([...])`.
  - **Connectors/vendors**: corrected connector-tool tables (GitHub 8 tools, Telegram/Twilio/Zoom params, risk levels), vendor-template ids (`google-api`/`microsoft`; 45 vendors, 49 logos), service counts (45+), and category tables.
  - **Defaults & paths**: InContextMemory 40k-token budget, shell `maxOutputSize` 10MB, `allowBackground` true, `MAX_HTML_LENGTH` 10MB, user-scoped storage paths.
  - Flagged non-functional/undocumented surfaces accurately (no built-in permission audit/policy storage, unfired lifecycle hooks, `REQUEST_TIMEOUT` not read). Doc version footers bumped to 0.10.3.

## [0.10.2] — 2026-07-04

### Fixed

- **A `refusal` stop_reason no longer triggers the empty-response retry loop, and the refusal is now clearly diagnosable.** When Anthropic's safety classifiers decline a request, the Messages API returns HTTP 200 with `stop_reason: "refusal"` and empty content. The agent's streaming loop treated that empty content as a transient empty response and retried it up to `maxRetries` times — futile, since an identical refused request deterministically refuses again, and it burned latency/tokens before silently accepting the empty result. Changes:
  - `mapAnthropicStatus('refusal')` now returns `'failed'` (terminal, non-recoverable — mirrors Google's `SAFETY`/`RECITATION` handling) instead of `'incomplete'`.
  - Both `Agent.stream()` and `Agent.run()` explicitly detect a refusal, **skip the retry**, and emit a `warn` whose **message text names the classifier category and explanation** (e.g. `LLM REFUSED the request: safety classifier "cyber" fired — "…". … Adjust the prompt/content for the "cyber" category to proceed.`) — not just structured fields a log formatter might drop.
  - Anthropic's `stop_details` (`{ type, category, explanation }`) is now captured from the streaming `message_delta` and the non-streaming response, threaded through `StreamState` → the `RESPONSE_COMPLETE` stream event and `LLMResponse.stop_details`, so callers can inspect *which* classifier fired programmatically. New exported type `ProviderStopDetails`; `LLMResponse` gains optional `stop_reason` / `stop_details`.

### Added

- **Current-generation Anthropic models registered.** Added `claude-opus-4-8`, `claude-sonnet-5`, and `claude-fable-5` to the model registry (1M input / 128K output, adaptive thinking, `temperature` unsupported). `claude-opus-4-8` and `claude-sonnet-5` are now the `preferred` Opus/Sonnet flagships (superseding `claude-opus-4-7` / `claude-sonnet-4-6`, which are demoted but remain active). This suppresses the "Anthropic model not in registry; defaulted max_tokens to library fallback" warning and gives these models their correct 128K `max_tokens` capability instead of the 64K last-resort fallback. Exposed as `LLM_MODELS[Vendor.Anthropic].{CLAUDE_OPUS_4_8, CLAUDE_SONNET_5, CLAUDE_FABLE_5}`.

## [0.10.1] — 2026-07-03

### Security

- **`MemorySystem.updateEntityMetadata` now enforces write authorization.** Previously the method read the entity through the caller's scope filter (which surfaces group/world-readable entities) and then called `store.updateEntity(next)` without checking `assertCanAccess(..., 'write', 'entity')`. Any caller who could READ an entity could mutate its metadata through this API — a real cross-tenant data-integrity hole. The check now matches `transitionTaskState`, `addEntityContextIds`, `archiveEntity`, `deleteEntity`, and `mergeEntities`.

### Added

- **Vendor-agnostic structured (JSON) output.** A single `responseFormat` option — `{ type: 'json_object' }` or `{ type: 'json_schema', schema, name?, description?, strict? }` — now works identically across **every** LLM vendor on `Agent.run()` / `stream()` (via `RunOptions`) and `runDirect()` / `streamDirect()` (via `DirectCallOptions`). The parsed value is attached to `response.output_parsed`. The library converts the request to each vendor's **native** structured-output mechanism where the model supports it — OpenAI Responses `text.format` (already present, now wired to the unified API) and Google/Vertex `responseJsonSchema` — and otherwise falls back to a strict prompt instruction. **Validation contract:** on the native path the vendor enforces the schema server-side; on the prompt-fallback path the library guarantees **valid, parseable JSON** (reusing the existing permissive JSON parser, with one bounded tool-free re-ask on parse failure) but does **not** itself validate schema conformance — validate `output_parsed` yourself if you need a hard guarantee (deliberate: no schema-validator dependency added). Native schema + tool-calling compose on OpenAI (no extra call); on Google/Vertex (and the prompt fallback) the constraint is applied to a final tool-free pass so tool use is never suppressed mid-loop, and when that reformat changes the answer the corrected JSON is **written back to conversation history** so session save/load and continuation match what the caller received. **Anthropic uses the prompt fallback** (see below). **`stream()` limitation:** structured output is enforced on streams only where it applies inline (native, or the prompt fallback with no tools) — `stream()` has no reformat pass, so with tools on a prompt-fallback vendor the streamed output is **not guaranteed** to be JSON (a warning is logged); use `run()` for that case, and note `output_parsed` is attached only on the non-streaming `run()` / `runDirect()` paths. Parse failures throw `StructuredOutputError` with the raw output + schema (logged, never silent). New module `src/core/StructuredOutput.ts`; exports `ResponseFormat`, `StructuredOutputError`, `parseStructuredOutput`, and helpers from the package root. Scope: JSON output only.
- **`MemorySystem.assertEnterpriseReady()`** — readonly healthcheck returning `{ok, findings}` with two readiness tiers. **`ok === true`** is the *minimum-safety* gate: no `severity: 'error'` findings remain, so data-integrity invariants are held and tenant isolation is enforceable (missing `visibilityPolicy` or `PredicateRegistry` are errors). **Full enterprise readiness** additionally requires `findings.every(f => f.severity !== 'warn')` — that covers the strict-vocabulary guarantee (permissive predicate mode is a warning, not an error), Mongo vector-index names, and other quality concerns. Operators who want the stricter gate compose the two booleans themselves; see the JSDoc on the method for the recipe. Hosts that just want "is this safe to boot" check `ok`.
- **`MemorySystem.getPredicateRegistry()`** — public accessor for the configured registry. Used by `MemoryWritePluginNextGen` to generate LLM-facing predicate vocabulary from the same source of truth that `addFact` validates against.
- **`MemorySystem.semanticSearchEntities(queryOrVector, filter, scope, opts?)`** — general-purpose entity-level semantic search over the content embedding (`IEntity.contentEmbedding`). The type-agnostic analog of `findSimilarOpenTasks` (task-only) and `searchDocuments` (document-only): ranks ANY entity type by similarity to a query, narrowed by the full `EntitySemanticSearchFilter`. Accepts a precomputed vector to skip the embed round-trip on fan-out; `embeddingField` defaults to `'content'` (pass `'identity'` for the resolver's name/identifier vector). Returns `[]` (never throws) when the store lacks a semantic-entity capability, when a string query is passed without an embedder, or when the underlying search throws — semantic similarity is opportunistic, never load-bearing. `EntitySemanticSearchFilter` and `EntityEmbeddingField` are now exported from the package root.
- **`EntitySemanticSearchFilter.touchesAnyOf?: EntityId[]`** — multi-anchor OR-wildcard, the set-valued analog of `touchesEntity`: returns entities touched by ANY id in the array (task-scoped → `metadata.{assigneeId,reporterId,projectId}` ∪ `contextIds`; other types → `contextIds` only). Pushed into the Atlas `$vectorSearch.filter` as one compound `$or` over `$in` so participant fan-out resolves in a single ranked query instead of N per-anchor top-K cuts unioned client-side. ANDs with `touchesEntity` when both are set. Also exposed as a `findSimilarOpenTasks` option. Every path is already declared in `ENTITIES_FILTER_PATHS` — no new Atlas index field required.
- **`MongoMemoryAdapterOptions.vectorIndexDrainPollMs` / `vectorIndexDrainTimeoutMs`** — tune the wait `ensureVectorSearchIndexes` performs when it must drop + recreate a drifted Atlas search index. Atlas removes a dropped index asynchronously and rejects a same-name create until it has fully drained, so the helper now polls (`vectorIndexDrainPollMs`, default 2s) until the old index is gone before recreating, bounded by `vectorIndexDrainTimeoutMs` (default 120s). Lower them in tests; raise the timeout for slow Atlas tiers.

### Changed

- **Tool results now stay inline in the input array for the whole agentic loop until a *critical* utilization threshold.** Compaction (and the algorithmic strategy's spill of large tool results into working memory) previously triggered at the strategy's own threshold — **75%** by default — so a tool-heavy agent (many file reads / API responses) would have its results yanked out of the conversation into the `notes` working-memory store well before the context was actually full, leaving only a one-line index the agent had to `store_get` back. Compaction is now gated on a separate **`criticalCompactionThreshold`** (default **0.9**, = `CONTEXT_DEFAULTS.HARD_LIMIT`) in `AgentContextNextGenConfig`: below it, **nothing** is compacted and every tool result is preserved verbatim; only once utilization crosses the critical line does compaction run — and it then reclaims down to the strategy's `threshold - 0.1` (clamped below critical so a misconfigured strategy threshold can never produce a no-op). The strategy `threshold` is now purely the reclaim *floor*, not the trigger. The post-cycle `AgentContextNextGen.consolidate()` (run by the agent at end of `run()`/`stream()`) is gated on the same threshold, so tool results are no longer spilled *between* turns while there's ample room. The emergency oversized-input truncation path remains the last-resort safety valve for a single batch that alone exceeds the window. Both the in-loop and post-cycle gates log (info) when they fire. Tune via `AgentContextNextGen.create({ criticalCompactionThreshold })`.
- **Google/Vertex provider now passes the JSON schema.** `GoogleConverter` previously set `responseMimeType: 'application/json'` but **dropped the schema** for `json_schema` requests. It now forwards the caller's schema via Gemini's `responseJsonSchema` (accepts a standard JSON Schema) for models the registry marks `structuredOutput: true`; unregistered models fall back to the prompt path. Vertex inherits this via `GoogleConverter`.
- **Anthropic uses the prompt fallback for structured output** (not native `output_config.format`). `AnthropicTextProvider` reports `supportsJSONSchema: false` because the registry's `structuredOutput` flag is set `true` even for older Claude models (e.g. `claude-3-7-sonnet`) that would `400` on `output_config.format`, and there's no precise per-model signal to gate it. The vendor-agnostic prompt fallback produces parseable JSON uniformly on every Claude model; native `output_config.format` can be enabled later behind an accurate capability gate.
- **`MemoryWritePluginNextGen` writes a predicate-vocabulary section generated from `PredicateRegistry.renderForPrompt()`** instead of a hand-maintained list. The previous static list named predicates (`full_name`, `preferred_name`, `prefers`, `dislikes`, `works_on`, `assigned_to`, `note`, etc.) that aren't in the standard registry — under default `predicateMode: 'permissive'` those writes silently created off-vocabulary records that the dedup layer couldn't merge with ambient-ingestor output. The plugin now embeds the live registry's rendering; falls back to a brief generic stub when no registry is configured. New optional `predicates` config field overrides the auto-derived registry (rare; mostly testing).
- **`memory_upsert_entity` no longer requires `identifiers`.** Empty / omitted identifiers fall through to normalized-displayName lookup within scope — the same path projects, topics, and clusters take when they have no natural strong key. Forcing the LLM to invent canonical slugs created false precision and harder future merges. The core `MemorySystem.upsertEntity` already supported the bare path; only the LLM tool wrapper was over-restrictive.
- **`updateFact` clamps caller-supplied `confidence` and `importance` to [0, 1]** at the boundary, matching `addFact`. A reconciliation pass that emitted `importance: 99` (LLM hallucination) would previously distort retrieval ranking; now it's clamped to 1.0. Only clamps when the caller actually provided the field; missing keys stay missing.
- **`addFact` sanitizes `contextIds`** (visibility-check + dedupe + drop empties + drop subject/object self-references). LLM extractions frequently emit the subject or object redundantly in `contextIds`, which made `memory_list_facts({contextId: subjectId})` surface every fact about that subject. Now mirrors the entity-create path's sanitation via a shared helper (`sanitizeContextIds`).
- **`decision_made` predicate documentation aligned with the storage contract.** The description and examples previously suggested both `value` and `objectId` could be set — `addFact` forbids that combination. Description now explicitly directs callers to use `contextIds` for the entities a decision is about; examples updated. No code change to the predicate; this is doc-only.
- **`findOuterScopePrior` JSDoc** now accurately describes that the empty `ScopeFilter` is a world-readable view (not a true admin bypass) — private and group-only outer facts are skipped, and the corresponding `fact.supersede_skipped_outer_scope` event won't fire for them. The behavior matches both Mongo and InMemory adapters; only the comment was misleading.
- **Predicate counts.** Authoritative count is 45 predicates across 10 categories (see `src/memory/predicates/standard.ts`). Stale "51-predicate" / "54-predicate" references in `PredicateRegistry.ts` and `CLAUDE.md` corrected.
- **`ensureVectorSearchIndexes` reconciles a drifted index in a single call.** Previously a drop-then-immediate-create raced Atlas's async drain of the old index: the create was rejected, the call threw, and reconciliation only succeeded on a later process boot. The helper now waits for the dropped index to fully drain before recreating (bounded by the new `vectorIndexDrainTimeoutMs`; on timeout it falls through to create, degrading to the prior retry-on-next-boot semantics and never hanging). One consequence: on the drift path the call can now block synchronously for up to the drain timeout — documented on the method and in the Mongo deployment checklist. The fresh-create path remains fire-and-forget.

### Fixed

- **`InMemoryAdapter.semanticSearchEntities` now honors `touchesEntity` and intersects it with `touchesAnyOf` (adapter parity).** The in-memory backend previously ignored `touchesEntity` entirely for entity semantic search (a parity gap vs. `MongoMemoryAdapter`), and the initial `touchesAnyOf` implementation unioned both filters into a single anchor set — silently turning the documented "ANDs with `touchesEntity` when both are set" contract into an OR. With both filters set, InMemory over-returned tasks touched by only one anchor while Mongo (separate `$or` clauses under a top-level `$and`) correctly intersected. Both filters are now evaluated as separate AND-ed conditions, matching Mongo and the documented contract. Covered by new both-set tests across both adapters.
- **Google `get_meeting_transcript` now finds Gemini "Take notes for me" Docs.** The Drive search query was hard-coded to `name contains 'transcript'`, which excluded Google's newer Gemini-generated meeting notes (filename suffix `- Notes by Gemini`, folder `Meet Notes`). Query now ORs both name patterns (`Transcript` ∪ `Notes by Gemini`) and matches the meeting title against the filename (not just `fullText`) — Gemini puts the title in the filename. New optional `since` arg (ISO date) restricts to recently modified files, useful for disambiguating recurring meetings. Tool description and not-found error updated to reflect both artifact types. Integration-test param renamed `testMeetingId` → `testTranscriptTitle` (the old param wasn't a tool argument and the test was effectively a no-op).

## [0.10.0] — 2026-05-27

### Memory — content-embedding composers + metadata-aware semantic search (2026-05-27)

**The retrieval-quality fix.** Pre-this-PR, `findSimilarOpenTasks` searched `IEntity.identityEmbedding` (composed from `type + displayName + aliases + identifiers` only). Tasks with generic titles like "Follow up" — 50 of them differing only by `metadata.assigneeId` / `metadata.projectId` — all produced **identical embeddings** and were indistinguishable to semantic search. Metadata changes (`transitionTaskState`, `updateEntityMetadata`, `addEntityContextIds`) never refreshed embeddings.

**Two-axis embedding model — never conflated:**
- `IEntity.identityEmbedding` — **unchanged.** Narrow: `displayName + aliases + identifiers`. Drives `EntityResolver` Tier 4 semantic resolution. Must stay narrow or resolver would merge tasks that share metadata.
- `IEntity.contentEmbedding` — **generalized.** Was document-only; now populated for every entity type with a registered composer. Drives `findSimilarOpenTasks`, `searchDocuments`, any `semanticSearchEntities({embeddingField:'content'})` retrieval flow.

**Per-type `EntityContentComposer` + `FactContentComposer` (`src/memory/composers/`).** Pluggable strategies that produce deterministic embedding-input text:
- **task:** `task: {name}\nState: {state}\nDue: {dueAt}\nPriority: {priority}\nAssignee: {resolved assignee displayName}\nReporter: ...\nProject: ...\nContext: {resolved contextIds}\nDescription: ...\nID: ...`
- **event:** name + when (start→end) + where + kind + resolved attendee displayNames + context + description.
- **person:** name + aliases + role + title + resolved org displayName + bio + identifiers.
- **organization:** name + domain (from identifiers) + industry + description.
- **topic / project / cluster:** name + type-specific metadata + resolved references.
- **document:** preserves legacy `title\n\n(summary | body[:limit])` shape.
- **atomic fact:** `"subject.displayName predicate (object.displayName | value)"` + optional details. Resolves entity ids to surface forms — e.g. `(Sarah, works_at, Acme)` now embeds as `"Sarah Chen works_at Acme Corp"` rather than disappearing entirely.

References (`assigneeId`, `projectId`, `contextIds`, fact `objectId`) **resolve to displayNames at compose time** via a per-call cached `ComposeContext`. Missing / invisible refs silently omit (no dangling-id text). One batched `getEntities` round-trip per compose; bounded cost.

Override per type via `MemorySystemConfig.entityContentComposers` / `factContentComposer`. Default registry shipped at `composers/defaults.ts`.

**Re-embedding triggers (the gap closed):** every entity mutation site composes the new text, diffs against `IEntity.contentEmbeddingText` (stored alongside the vector), and enqueues only when different. Same model for facts. Wired into: `createEntity`, `upsertEntity`, `upsertEntityBySurface`, `appendAliasesAndIdentifiers`, `mergeEntities`, `updateEntityMetadata`, `transitionTaskState` (state appears in embedded text → terminal tasks naturally rank lower), `addEntityContextIds` (anchor displayNames flow into the embedding), document CRUD, `addFact`, `updateFact`, `updateFactDetails`.

**`findSimilarOpenTasks` switched to `contentEmbedding`.** New `opts.assigneeId` / `opts.reporterId` / `opts.projectId` / `opts.touchesEntity` narrows pushed into the Atlas vector pipeline. `touchesEntity` is the OR-wildcard equivalent — matches tasks where the given entity appears in any of `metadata.{assigneeId, reporterId, projectId}` or top-level `contextIds`, pushed as one compound `$or` into `$vectorSearch.filter` (so vector ranking sees the participant-touching candidates together instead of competing across role-specific top-K cuts). State filter pushed into the pipeline via `EntitySemanticSearchFilter.states` — eliminates the post-filter starvation that forced over-fetching.

**80-char threshold for atomic-fact embedding is gone.** Pre-this-PR: `computeIsSemantic` gated atomic facts on `details.length >= 80`, so the bulk of structural relationships (`works_at`, `reports_to`, etc.) were invisible to semantic search. Post: composer produces meaningful surface text for every fact; eligibility driven by `isSemantic` (default `true` for new facts, callers opt out with `isSemantic: false`).

**Atlas filter paths expanded.** `ENTITIES_FILTER_PATHS` now declares `metadata.{state, assigneeId, reporterId, projectId, dueAt}`. `entitySemanticFilterToMongo` translates the new `EntitySemanticSearchFilter` fields. Without this, Atlas would silently drop the filter clauses (scope-bypass risk + post-filter starvation).

**Cascade-on-rename is intentionally NOT implemented.** When entity X is renamed, dependent embeddings (tasks where X is assignee, etc.) go stale until those entities are next mutated. Eventual consistency. Run `MemorySystem.backfillContentEmbeddings(scope)` after a rename campaign if you need immediate convergence.

**Migration helpers:**
- `MemorySystem.backfillContentEmbeddings(scope, {types?, batchSize?, onProgress?})` — entities. Idempotent (skips when stored text matches composer output).
- `MemorySystem.backfillFactEmbeddings(scope, {predicates?, kind?, batchSize?, onProgress?})` — facts.

**Schema additions:**
- `IEntity.contentEmbeddingText?: string` — verbatim text that produced `contentEmbedding`. Diff target for the call-site dedup check, debug-readable for operators.
- `EntitySemanticSearchFilter.{states, assigneeId, reporterId, projectId, dueAtRange, touchesEntity}` — task-aware narrows for semantic search. `touchesEntity` is a type-keyed OR-wildcard: for `type:'task'` (or `types:['task']`) expands to `$or` over the three role paths + `contextIds`; for any other type, falls back to `contextIds`-only (the one universal relational anchor).
- `MemorySystemConfig.entityContentComposers?: Record<string, EntityContentComposer>` + `MemorySystemConfig.factContentComposer?: FactContentComposer`.

**Mongo deployment notes:**
- Hosts that have already created the entity vector indexes need to recreate them once for the new filter paths to take effect (or filter clauses on the new paths will silently drop). `ensureVectorSearchIndexes()` will recreate as needed if you delete the existing index; otherwise reuse the existing index — content-embedding still works, just without push-down on the new metadata paths.
- For new content-embedding retrieval, pass `entitiesContentIndexName: 'entities_content_vector'` to `ensureVectorSearchIndexes()` (or set `entityContentVectorIndexName` on the adapter). Adapter falls back to cursor-scan cosine when the content index isn't present — slower but correct.

**Tests:** 1277 memory tests pass (was 1256). New tests cover every composer, re-embedding at every mutation path, metadata-aware ranking ("two tasks with identical titles, different assignees, query mentions one assignee → that one wins"), and the backfill helpers.

### Memory — entity-level `contextIds` (backwards-compatible addition)

`IEntity.contextIds?: EntityId[]` lands as a top-level field on entities, mirroring `IFact.contextIds`. It expresses the multi-valued "lives within" edge — a task in `[projectA, dealQ3]` surfaces on `getContext.relatedTasks` queries for either anchor. Designed for `task` / `event` / `topic` entities; field is open to any type.

**Why now.** Prompt v10 (2026-05) made tasks self-sufficient by removing the parallel `committed_to(person, task)` fact, but left no replacement for the multi-entity binding (a task lives in a project AND a deal AND a meeting). The single-valued `metadata.projectId` couldn't carry it; fact-level `contextIds` belongs to *one fact about multiple entities*, not *one entity within multiple contexts*. Entity-level `contextIds` closes the gap.

- **Schema (types.ts).** `IEntity.contextIds` (top-level) + `EntityListFilter.contextId` (first-class filter; does NOT go through `metadataFilter`).

- **Write API.** New `MemorySystem.addEntityContextIds(entityId, additions, scope)` — visibility-validates each addition, drops self-references, dedupes, RMW with optimistic-concurrency retry (cap 3). `upsertEntity` / `upsertEntityBySurface` / `tryAtomicCreateOrResolve` all thread `contextIds`. **Union merge on resolve** — never overwrites, never fills-missing.

- **Read API.** `resolveRelatedTasks` / `resolveRelatedEvents` gain a tier-1.5 path that hits the new index directly (`listEntities({type, contextId, …})`). Fact-walk tier retained as the legacy fallback. `listOpenTasks` / `iterateOpenTasks` accept `opts.contextId`. `findSimilarOpenTasks` accepts `opts.contextId` (pushed into `$vectorSearch.filter`).

- **Mongo indexes.** New b-tree indexes `{groupId, type, contextIds}` and `{ownerId, type, contextIds}` (sparse) installed by `ensureIndexes`.

- **Atlas vector-search.** `'contextIds'` added to `ENTITIES_FILTER_PATHS` so the new `findSimilarOpenTasks({contextId})` filter clause is honored by `$vectorSearch` (same hard-earned rule the recent FACTS_FILTER_PATHS work codified for facts). **Existing deployments will see one drop+recreate cycle on the entities vector index on next `ensureVectorSearchIndexes()` run** — 30-60s typical, queries fall back to cursor-scan cosine during the rebuild. No action required.

- **Merge integrity.** `mergeEntities` rewrites entity-level `contextIds` (loser → winner, deduped, self-reference suppressed). Without this step every entity merge would leave permanent dangling pointers — the same v25 wrapper gap the fact path closed.

- **Archive/delete semantics.** `archiveEntity` and `deleteEntity` follow the **tombstone rule** for `contextIds` — references to the archived/deleted entity are left in other records as dangling pointers (readers resolve to `null`). Symmetric with long-standing fact-`contextIds` behavior, codified in JSDoc.

- **Extraction (prompt v11, parser, resolver).** Mention schema gains a top-level `contextIds: ["m_..."]` array (NOT inside `metadata`). `parseExtractionWithStatus` validates as `string[]`. `ExtractionResolver` adds Pass 1.6 — after all mentions resolve, walks `mention.contextIds`, translates labels → entity ids, calls `addEntityContextIds`. **Two-pass design means forward references work** (a task can reference a deal that appears later in the mentions list).

- **Resolver API rename.** `ResolveEntityQuery.contextEntityIds` → `disambiguationEntityIds`. Old name kept as `@deprecated` alias; resolver accepts both, new name wins on collision. Same rename on `UpsertBySurfaceInput`. The rename avoids collision with the new persistent `IEntity.contextIds` field — one is a resolution-time hint, the other is a persistent edge.

- **Migration helper.** `MemorySystem.hoistContextIdsFromFactsToEntities({predicate, entitySide, entityType?, dryRun?, archiveSource?, …}, scope)` — generic, idempotent. Reference recipe: `{predicate: 'committed_to', entitySide: 'object', entityType: 'task'}` hoists legacy v10-era deal/project linkage onto task entities.

### Memory (Mongo) — vector-search index auto-reconcile

- **`FACTS_FILTER_PATHS` adds `contextIds` (correctness).** Without this filter path declared on the Atlas vector-search index, `FactFilter.touchesEntity` (which OR's `subjectId`/`objectId`/`contextIds` in `queries.ts`) and `FactFilter.contextId` were silently scope-bypassing on the `$vectorSearch` fast path — modern Atlas errors with `"Path 'contextIds' needs to be indexed as filter"`, older versions silently dropped the clause and returned cross-context matches. Existing deployments will pick up the new path automatically via drift-recreate (below).

- **`MongoMemoryAdapter.ensureVectorSearchIndexes()` now reconciles drift.** Compares the stored Atlas index definition (vector path/dims/similarity + filter-path set) against the library's desired definition. On mismatch — typical scenario: library version bump added a filter path — drops + recreates so the new fields take effect (Atlas does not support in-place edits to vector-search index definitions). Tolerates concurrent-drop and post-drop-draining races; surfaces "stale definition but cannot reconcile" if the wrapper does not implement `dropSearchIndex`. Logs a `console.warn` when reconciling: queries fall back to cursor-scan cosine for ~30–60s while Atlas rebuilds.

- **New requirement on collection wrappers: `dropSearchIndex`.** Added to `IMongoCollectionLike` as optional. Implemented for `RawMongoCollection` and `MeteorMongoCollection` (both delegate to the mongodb node driver v6.6+ method). Custom wrappers that don't implement it will hit a clear error if drift is ever detected; up-to-date wrappers are unaffected.

- **Operator impact on upgrade.** Existing deployments that use the facts vector-search fast path will see one drop+recreate cycle on first startup after upgrading; vector queries fall back to cursor-scan cosine (~30–60s typical) during the Atlas rebuild. No action required.

### Memory — `embedQuery` + precomputed-vector overloads on semantic search

Avoids re-embedding the same query when fanning out searches with different filters (multi-predicate searches, RAG with per-tenant filters, etc.). The embed cost is now paid once and reused across N filter variants.

- **New `MemorySystem.embedQuery(query): Promise<number[]>`** — embeds a query once. Throws `SemanticSearchUnavailableError` when no embedder is configured, mirroring `semanticSearch`'s error contract.
- **`MemorySystem.semanticSearch(queryOrVector, ...)`** — accepts `string | number[]`. With `string`, behavior is unchanged (one embed per call). With `number[]`, no embedder is required (the vector is already available); only the store-capability check applies.
- **`MemorySystem.findSimilarOpenTasks(queryOrVector, ...)`** — same widening. With a vector, the embedder check is skipped.

Backward-compatible — all string-form callsites work identically.

### Memory — `mergeEntities({allowCrossOwner: true})` (opt-in)

New optional option on `MemorySystem.mergeEntities(winnerId, loserId, scope, options?)`. Lets a group/super admin consolidate group-visible duplicates (Person/Organization records the host's pipeline created across multiple owners in the same tenant) without first re-owning every loser.

- **Default behavior unchanged.** Without the flag, both `winner` and `loser` still need `write` access under the caller's scope.
- **Cross-owner merge.** With `allowCrossOwner: true`, the per-entity `assertCanAccess(write)` is skipped on both winner and loser, AND the same bypass is applied while rewriting fact references via `rewriteFactReferences` so the graph stays coherent post-merge.
- **Tenancy invariant preserved.** The call refuses if `winner.groupId !== loser.groupId` — this option never enables cross-tenant data movement. Host is responsible for gating which callers may pass the flag (typically a group admin).

### Memory — `RestrainedExtractionContract` no longer drops task mentions (BEHAVIOR CHANGE)

Pre-this-release, `requirePriorityBinding: 'strict'` dropped task mentions that lacked a valid `metadata.servesAnchorId`, or all task mentions if no anchors were active. This silently hid genuine commitments from users whose priorities weren't yet set, and produced "orphan" task-shaped facts upstream when downstream entities referenced the dropped mentions.

- **Tasks ALWAYS extract regardless of mode.** Binding state is annotated via emitted `RestraintEvent`s so the host can score unbound tasks lower (typically FYI) without losing them from the knowledge graph.
- **New `reasonCode` values on `kept` events:**
  - `priority_bound` — valid `servesAnchorId`
  - `priority_unbound` — missing binding, strict mode (still kept)
  - `priority_unbound_soft` — missing binding, soft mode (still kept)
  - `priority_stale` — stale/unknown binding, strict mode
  - `priority_stale_soft` — stale/unknown binding, soft mode
  - `no_anchors` — no active anchors, informational (still kept)
- **Pre-v10 strict-mode-drops behavior is gone.** Downstream scoring decides Decision Queue visibility on the surfaced `reasonCode` — the contract surfaces, it never withholds.

### Memory — explicit pagination order on internal walks (correctness)

Several internal pagination loops were relying on adapter natural-order (`_id asc` on Mongo, `Map.values()` on InMemory), which trips the recently-introduced order-warning on bounded list calls and risks dropping items when a cursor's anchor moves under concurrent writes.

- `MemorySystem.rewriteFactReferences` (subject / object / context walks during `mergeEntities`) — explicit `orderBy: { field: 'createdAt', direction: 'asc' }`. Stable, monotonic, unaffected by the loop's writes.
- `MemorySystem.backfillContentEmbeddings` listEntities walk — explicit `orderBy: { field: '_id', direction: 'asc' }`.
- `findDuplicateClusters` / `findIdentifierClusters` in `dedup.ts` — explicit `orderBy: { field: '_id', direction: 'asc' }`.

Behavior-equivalent for any host that wasn't seeing order-warning noise; the change is purely about making the contract explicit.

## [0.9.2] — 2026-05-26

### Memory — dedup migration enablers

Two targeted fixes that unblock the v0.9.1 dedup migration path for hosts (v25) consolidating legacy duplicate-entity backlogs:

- **`ScoreThresholds.singleTokenGuardTypes` (BEHAVIOR CHANGE).** The single-token-name guard in `scoreEntityPair` previously fired for ANY pair of entities sharing a single-token short normalized name — capping score at 0.85 and routing to `'review'`. In production this blocked 41 ICOS-project rows from auto-merging (same single-token name, no identifier; landed at 0.85 in the review band).

  The guard is now scoped to specific entity types via `singleTokenGuardTypes` on `ScoreThresholds`. **Default: `['person']`** — only persons get the cap. Projects / organizations / events with names like "ICOS" / "EW" / "Prep" are tenant-unique by convention and now auto-merge on name + alias + token signals. Callers can include other types via override or pass `[]` to disable entirely.

  Behavior change in scope: tests that asserted single-token-short-name short-circuit-to-review for non-person types now auto-merge. Existing test `normalized name equal + alias overlap on short single-token names → review` rewritten to use type=person (where the guard still applies).

- **`findIdentifierClusters(memory, scope, opts?)` (new public API).** Companion to `findDuplicateClusters` — enumerates `(identifier.kind, identifier.value)` groups where `≥ minClusterSize` entities share an identifier. Catches the dup pattern where two entities share an email/slack_id/github but have different displayNames ("Pavel" + "Pavel Khasanov" both with `email: pavel@everworker.ai`) — invisible to the name-keyed snapshot. Case-folds via `normalizeIdentifierValue` so `email: A@X.COM` and `email: a@x.com` cluster together; `github: Anton` and `github: anton` stay separate (per `identifierValuesEqual` contract).

  Returns `IdentifierCluster[]` sorted by cluster size desc. Options: `kinds` filter, `type` filter, `minClusterSize` (default 2), `limit` (default 100), `pageSize` (default 500). Same client-side aggregation model as `findDuplicateClusters` — fast under ~10k entities.

**Test status:** 11 new tests across `dedup.test.ts` (5 type-scoped guard cases + 6 identifier-cluster cases). Full memory suite: 1198 passing.

**Migration impact:** This release is REQUIRED for the v0.9.1 dedup migration. Without these fixes, the migration's `scoreEntityPair`-driven auto-merge step would skip the 41-ICOS / 18-Jarvis / 15-EW / etc. clusters that motivated the work.

## [0.9.1] — 2026-05-26

### Memory — semantic auto-resolve at creation (BEHAVIOR CHANGE)

**Closes the root cause of the production duplicate-entity backlog.** Prior to 0.9.1 the resolver's Tier 4 (semantic match) existed but was:
(a) **opt-in** (`enableSemanticResolution: false` by default) and
(b) **capped at confidence 0.89** — strictly below the 0.90 auto-resolve threshold.
Even with the flag flipped on, semantic candidates only ever became advisory `mergeCandidates`; the LLM-driven extraction path then unconditionally created a new entity. This is exactly the failure mode that produced 41 "ICOS" project rows, 32 "Pavel" person rows, and 51 distinct event-name dup clusters in a single production tenant.

0.9.1 fixes the wiring at three layers:

- **`enableSemanticResolution` defaults to `true`.** Existing deployments that explicitly set it to `false` keep their behavior; deployments that never set it now get semantic Tier 4 active out of the box.
- **`semanticConfidenceCap` raised to 0.95** for types in `semanticAutoResolveTypes` (default `['organization', 'project', 'event', 'topic', 'task', 'cluster']`). This is **above** the 0.90 auto-resolve threshold, so a strong cosine hit silently auto-merges into the existing entity instead of producing a new row. Calibrated against production cosine data: within-cluster medians 0.89-1.00, cross-cluster maxes 0.77-0.86 — 0.95 sits well above every observed cross-cluster ceiling.
- **Persons are intentionally excluded** from semantic auto-resolve. Same-first-name collisions are common ("Pavel" matches another "Pavel" at cosine 1.0 in any multi-Pavel tenant). For type=person the cap stays at the legacy 0.89 — Tier 4 surfaces the candidate in `mergeCandidates` for review but never silently merges. Plus a structural **person rule**: Tier 2 (displayName equality) and Tier 3 (alias equality) skip the lookup entirely for single-token person surfaces ("Pavel" / "John" / "Vlad" alone), AND single-token-no-identifier person upserts bypass the atomic `(type, normalizedDisplayName)` find-or-create primitive. Persons only auto-merge on:
  - Tier 1 identifier match (email, slack_id, github, …), OR
  - Multi-token normalized name equality ("Pavel Khasanov" === "Pavel Khasanov").

**New config knobs (`EntityResolutionConfig`):**
- `semanticAutoResolveTypes?: string[]` — which entity types get the full cap (and thus auto-resolve eligibility). Default per above; empty array disables semantic auto-resolve entirely.
- `semanticConfidenceCap?: number` — default 0.95. Lower if you want stricter gating.
- `semanticMinScore?: number` — default 0.75 (unchanged from previous hardcoded value). Cosine floor for semantic candidacy.

**New `ChangeEvent` variant:**
- `entity.upsert.semantic_automerge` — fires whenever Tier 4 drives an auto-resolve. Carries `{entityId, mergedSurface, cosine, mergeCandidateIds}`. Lets hosts route silent merges to an activity log without scraping console warnings. The resolver also `logger.warn`s every semantic auto-merge with the same payload (per CLAUDE.md no-silent-decisions policy).

**Extended public types:**
- `EntityCandidate.rawSemanticScore?: number` — un-capped cosine, set only when `matchedOn === 'embedding'`. Useful for audit logs that want the raw signal rather than the type-capped confidence.
- `UpsertBySurfaceResult.matchedOn?: 'identifier' | 'displayName' | 'alias' | 'fuzzy' | 'embedding'` — which tier drove the auto-resolve winner. Undefined when `resolved: false` or when resolved via the atomic-create-or-resolve race-loss path.
- `UpsertBySurfaceResult.rawSemanticScore?: number` — same un-capped cosine as on the candidate. Surfaces on the result so v25 host can write to its `jarvis_activity_log` without re-querying.

**Tier priority bug fixed alongside.** Prior to 0.9.1 the same-entity tier ranking in `EntityResolver.resolve` was a numeric `confidence` comparison that happened to give the right answer only because Tier 4 cap (0.89) sat below Tier 2 (0.90). With the cap raised, the numeric check would silently overwrite a `displayName` match with an `embedding` one — and `matchedOn` would lie. Tier priority now checks `matchedOn` explicitly: Tier 4 NEVER replaces an exact-tier hit on the same entity.

**Test status:** 9 new tests in `EntityResolver.semanticAutoMerge.test.ts`. Existing tests updated where they asserted legacy 0.89 cap / opt-out default. Full memory suite: 1187 passing.

**Operational impact:** Once this version is deployed, NEW LLM extractions of existing surfaces ("ICOS", "Pavel Khasanov", "Acme Solutions") will resolve to the best existing entity via Tier 4 instead of creating a new row. Existing duplicates (41 ICOS, 32 Pavel, etc.) need a one-shot migration to consolidate — see migration instructions in the release notes.

## [0.9.0] — 2026-05-26

### Memory — Phase B: merge correctness + dedup tooling + extraction richness

Three-PR series following Phase A (0.8.0). Builds the host-facing tools v25 needs to enumerate, score, and clean up the duplicate-entity backlog Phase A's normalized-name + atomic-upsert work surfaced.

### Memory — Phase B PR 3: dedup tooling

Generic, type-agnostic primitives for finding, scoring, and surveying duplicate entity clusters. Lets hosts (v25 in particular) build operator queues, sweepers, and audit tooling on a stable library API rather than reinventing scoring in app code. Production data motivating this work: a single tenant carries 41 ICOS-project variants, 32 Pavel-person variants, 35 "Prep" event variants, and 51 distinct event-name dup clusters (`memory/project_prod_dedup_audit_2026_05_26`).

**Single new module: `src/memory/dedup.ts`.** Top-level re-exports surface every public symbol.

- **`scoreEntityPair({ a, b, factsA?, factsB? }, thresholds?) → DedupDecision`** — six-signal scorer:
  - **Hard zero (action: 'skip', score: 0):** type mismatch; identifier conflict (same kind, different values); event-time conflict (both entities carry `metadata.startTime` and the absolute delta exceeds `eventStartTimeDeltaMinutes`, default 60). The event-time rule is non-negotiable for recurring series — Mon vs Tue standups MUST NOT collapse.
  - **Auto-merge short-circuit (action: 'auto-merge', score: 1):** any (kind, value) identifier exact match. Case-insensitive for kinds the library marks case-insensitive (email, domain, phone, url_host).
  - **Weighted sum (default thresholds: auto 0.92, review 0.75):** normalized displayName equality (0.55), pooled-alias Jaccard (0.30), token-set Jaccard over normalized name (0.20), identity-embedding cosine via linear ramp 0.70 → 0.95 (0.30), contextIds-overlap from caller-supplied facts (0.15), same-`sourceSignalId` proximity boost (0.10).
  - **Single-token-name guard:** when both names are a single token < 5 chars (e.g. "John", "ICOS"), final score is clamped to ≤ 0.85. Production-driven — these surfaces need an identifier or embedding to push past the guard.
  - **Weights are config:** `ScoreThresholds.weights: Partial<SignalWeights>` overrides on a per-key basis. `DEFAULT_WEIGHTS` re-exported for hosts that want to introspect.
  - **Winner selection (deterministic):** more identifiers → more atomic facts → has profile fact → older `createdAt` → lexicographic id (final stable fallback).
- **`findDuplicateCandidates(memory, entity, scope, opts?) → IEntity[]`** — per-entity finder. Fuses identifier matches, `findEntitiesByNormalizedName` (with `matchAliases: true`), and optional `semanticSearchEntities` via `identityEmbedding`. Dedupes, excludes self + archived. `opts.includeSemantic: false` skips the vector pass for cheap structural scans.
- **`findDuplicateClusters(memory, scope, opts?) → DuplicateCluster[]`** — admin snapshot of `(type, normalizedDisplayName)` groups with `count >= minClusterSize` (default 2). Sorted by cluster size desc. Paginates through `listEntities` and groups client-side — fast for tenants ≤ 10k entities. Adapters wanting native aggregation can override.
- **`sweepDuplicates(memory, scope, opts?) → AsyncIterable<DedupDecision>`** — generator wrapping cluster enumeration + pair-scoring. Yields decisions largest-cluster-first, score-desc within a cluster, so callers can `break` early once high-value merges are consumed. Deliberately does NOT call `mergeEntities` — separation of concerns. Hosts route each decision (auto-merge / queue / skip) per their policy.

**Not included:** `bulkMergeEntities` (a single-line for-loop in caller code; YAGNI). `EntityUpsertEvent.resolvedTier` annotation (deferred — threading through eight emit sites is significant code surface for ambiguous value; the existing `entity.upsert.ambiguous` event already covers the highest-signal "dedup-needed" case).

27 new tests in `tests/unit/memory/dedup.test.ts`. Full memory suite: 1174 passing.

### Memory — Phase B PR 2: extraction richness (subject-of hints)

Production data on one tenant: organizations average **0 atomic facts per entity**, projects 2.5%-with-≥3-facts, events 5%. The structural bottleneck for non-person-subject profile coverage is the extraction prompt itself — the default `(person, predicate, otherEntity)` shape starves non-person entities of self-descriptive content. Closing the per-type-profile-threshold gap with a config knob would treat the symptom; this PR fixes the cause.

- **`PredicateRegistry.renderForPrompt({ groupBy: 'subjectType' })`** — new bucketing dimension. Predicates render under a `### When the subject is a \`X\`` header for each entry in their `subjectTypes`. Predicates without `subjectTypes` go to a `generic` bucket rendered last. Original `groupBy: 'category'` remains the default — every existing caller stays bit-identical.
- **`ExtractionPromptContext.subjectOfHintsEnabled?: boolean`** — opt-in flag. When `true`:
  - Predicate registry renders with `groupBy: 'subjectType'` so the LLM sees vocabulary organized by who can be the subject.
  - A new `## Subjects beyond persons` guidance section explains when to emit subject-of facts, with explicit restraint language ("casual mention does NOT warrant a fact").
  - A positive example demonstrates project-as-subject extraction with the narrative carried in `value`/`details`, not decomposed into per-attribute facts.
- **`DEFAULT_EXTRACTION_PROMPT_VERSION` bumped 8 → 9**.

Hosts whose registries lack `subjectTypes` annotations should leave the flag off — the grouping degrades to a single `generic` bucket and just costs prompt tokens. Tag the registry first, then opt in.

12 new tests across `PredicateRegistry.subjectTypeGrouping.test.ts` + `defaultExtractionPrompt.subjectOfHints.test.ts`. Full memory suite: 1147 passing.

### Memory — Phase B PR 1: merge correctness

Three closed bugs in `MemorySystem.mergeEntities`. Hosts working around (1) with a `mergeEntitiesWithContextRewrite` wrapper can drop it. The fixes are silent corrections — no API surface change — but observable behavior shifts for callers that exercise the merge path.

- **`contextIds` are now rewritten on merge.** Previously `mergeEntities` rewrote `subjectId` and `objectId` on facts but left every fact's `contextIds` array pointing at the archived loser. Queries via `getContext` / `touchesEntity` skipped the winner along that edge, hiding merged-in context bindings (deals, projects, meetings). The rewriter now scans facts where `contextId === loserId`, strips the loser, appends the winner (deduped, and dropped when it would duplicate the fact's own subject/object).
- **Winner's profile is re-derived after merge.** The winner's effective atomic-fact count grew when the loser's subject-facts retargeted, but `maybeRegenerateProfile` was never invoked — so production profile narratives went stale immediately after a merge. Merge now triggers a background regen on the winner's scope (non-blocking, uses the same in-flight dedup map as on-write regens).
- **Winner's identity embedding is refreshed when the union widens.** `mergeEntities` called `store.updateEntity` directly, bypassing the embed queue. Winner's `identityEmbedding` therefore reflected only the pre-merge surface, leaving semantic resolution under-matched on alias/identifier surfaces contributed by the loser. Merge now routes through `queueIdentityEmbedding`, which short-circuits when the combined identity string is identical to the pre-merge string — so merges that strictly add zero new surface incur no embedder cost.

**Test coverage:** 7 new tests in `tests/unit/memory/MemorySystem.merge.correctness.test.ts`. Full memory suite 1135 tests pass.

## [0.8.0] — 2026-05-26

### Memory — Phase A: entity-duplication root cause fix

Six-commit series eliminating the four structural causes of intra-user entity duplicates surfaced in production (40 ICOS / 32 Pavel / 35 "prep" event clusters). Commits land in dependency order; each is independently runnable but the dup-rate improvement materializes once Commits 3 + 4 are in. The Step-0 commit (test `Dup.repro.test.ts`) documents the four causes (R1 concurrency, R2 alias-tier, R3 substring-cap, R4 bare-upsertEntity) and ships repros that flip from "asserts buggy behavior" to "asserts fix" as the relevant commits land.

**Migration path on a live Mongo deployment:**
1. Deploy 0.8.0 — Commit 1 starts stamping `normalizedDisplayName` / `normalizedAliases` on every entity write. Existing rows are untouched.
2. Run `MemorySystem.backfillNormalizedFields(scope)` (Commit 6) from your migration framework — populates the normalized fields on every legacy entity.
3. Run a deduplication pass against the now-populated normalized field (host tooling — `findDuplicateClusters` admin API is Phase C work; for now use ad-hoc Mongo aggregations grouped by `(type, normalizedDisplayName, groupId, ownerId)` for clusters of >1).
4. Install the unique partial index by calling `ensureNormalizedNameUniqueIndex(entitiesCollection)` (Commit 3) — fails if dups remain, succeeds once dedup is complete. After this point, cross-process concurrency cannot reintroduce dups.

**Behavior changes worth flagging:**
- Alias-tier confidence default is now `0.90` (was hardcoded `0.85`). Hosts that relied on alias-only matches surfacing as merge candidates must set `entityResolution.aliasMatchConfidence: 0.85` to restore the old behavior. (Commit 4)
- Bare `upsertEntity` with empty identifiers now dedupes by normalized displayName. Callers with identifiers are unaffected (the identifier carve-out preserves the old "two emails, same name = two people" semantic). (Commit 5)
- New `ChangeEvent` variant `entity.upsert.ambiguous` fires when bare `upsertEntity` hits multiple legacy dups. Subscribe to surface dirty data. (Commit 5)

**Test status:** 5677 unit tests pass on InMemory. 4 new test files (`Dup.repro.test.ts`, `MemorySystem.normalizedName.test.ts`, `EntityResolver.indexedLookup.test.ts`, `EntityResolver.aliasConfidence.test.ts`, `MemorySystem.atomicUpsert.test.ts`, `MemorySystem.bareUpsert.test.ts`, `MemorySystem.backfillNormalized.test.ts`). Mongo integration tests gated on `mongodb-memory-server` cover R1 concurrency convergence + Commit 1 stamping + `ensureNormalizedNameUniqueIndex` E11000 recovery — run via `npm run test:integration` after `npm install --save-dev mongodb mongodb-memory-server`.

### Memory — Phase A Commit 6: backfillNormalizedFields + 0.8.0 version bump

- **New `MemorySystem.backfillNormalizedFields(scope, opts?)`** — paginated rewrite that populates `normalizedDisplayName` + `normalizedAliases` on entities written before 0.8.0 (or by adapter code that bypassed the boundary stamp). Returns `{scanned, updated, skipped}`. Idempotent — repeat calls are all-skipped. `opts.force: true` recomputes regardless of stored value (use after tweaking `normalizeSurface`). `opts.batchSize` default 500, clamped to `[1, 1000]`. Handles optimistic-concurrency conflict with a single re-read retry.
- **Version bump 0.7.0 → 0.8.0** (semver minor) reflects the behavior changes in Commits 4 + 5. No package boundary breakage (all additions; the alias-confidence default change is gated on the new `aliasMatchConfidence` config knob).
- 5 new backfill tests including idempotency, force-mode, scope filtering, and pagination. 5682 unit tests pass.

### Memory — Phase A Commit 5: bare `upsertEntity` dedupes via normalized name (BEHAVIOR CHANGE)

Closes R4 — direct callers of `MemorySystem.upsertEntity` that pass NO identifiers and the same displayName now converge on a single entity instead of accumulating duplicates.

- **`MemorySystem.upsertEntity`** — when `input.identifiers.length === 0` AND no identifier-driven match was found, the method now runs `findEntitiesByNormalizedName(type, normalized, scope, {limit:2})`:
  - 0 hits → route through `tryAtomicCreateOrResolve` (atomic primitive — concurrent-safe).
  - 1 hit → route through `tryAtomicCreateOrResolve` (resolves to the existing entity, accumulates aliases/identifiers/metadata via `appendAliasesAndIdentifiers`).
  - 2+ hits → emit new `entity.upsert.ambiguous` change event AND fall through to plain `createEntity`. The library refuses to arbitrarily merge into one of multiple legacy dups; hosts should subscribe to this event and run a dedup pass.
  - Empty normalized form (pure-punctuation displayName) → plain `createEntity` (no key to dedup on).
- **Carve-out preserved** — when `input.identifiers.length > 0`, identifiers remain authoritative: the caller is asserting "this is a distinct entity even if it shares a displayName with another". Existing test patterns (two `seedEntity()` calls with different emails but the same `displayName:'Test'`) continue to produce distinct rows.
- **New `ChangeEvent` variant: `entity.upsert.ambiguous`** with `{type_, normalizedDisplayName, candidates: EntityId[], createdId}`. Observability for legacy-data dup clusters.
- **Tests** — `tests/unit/memory/MemorySystem.bareUpsert.test.ts` (6 tests covering convergence, concurrency, the identifier carve-out, alias accumulation, pure-punctuation fallback, and the ambiguous emit). R4 repro flipped (was 2 entities, now 1). All 5671 unit tests pass.

### Memory — Phase A Commit 4: alias-tier confidence configurable, default 0.90 (BEHAVIOR CHANGE)

The Tier-3 alias-match confidence now defaults to **0.90** (was hardcoded 0.85). Exact alias matches auto-resolve at the default `autoResolveThreshold` (0.90) — closes R2 from Step 0.

- **`EntityResolutionConfig.aliasMatchConfidence`** — new optional field, default 0.90. Hosts that want the pre-0.8.0 advisory-only semantics for aliases can pin this to 0.85.
- **`EntityResolutionConfig.displayNameMatchConfidence`** — new optional field, default 0.90. Symmetry with the alias knob; lets hosts lift displayName above semantic-cap (0.89) if they want a clean separation.
- **`EntityResolver.exactMatchTier`** reads the configured confidences instead of hardcoded constants. Defaults preserved for both — the only behavior change is the alias-tier value going from 0.85 to 0.90.
- **Why it's safe with normalized aliases indexed (Commit 1+2):** the alias hit comes from the same O(1) lookup as displayName, against deduped + normalized storage. There's no structural difference in match strength — the old 0.85 was an artifact of the substring-matching era when aliases were a noisier signal.
- **Migration impact:** any host that *relied on* alias-only matches falling below threshold (to keep entities separate that share an alias) will start seeing them merge. Fix: configure `aliasMatchConfidence: 0.85`. The existing `ExtractionResolver.test.ts` "surfaces mergeCandidates when alias-tier match is below autoResolveThreshold" test now opts into this explicitly.
- **Tests** — `tests/unit/memory/EntityResolver.aliasConfidence.test.ts` (4 tests covering both knobs + their combination). R2 repro in `Dup.repro.test.ts` flipped (was 2 entities, now 1). 5671 unit tests pass.

### Memory — Phase A Commit 3: atomic upsert + unique partial index (LOAD-BEARING)

The core dup-stopping change. Concurrent `upsertEntityBySurface` calls for the same surface now converge on a single entity instead of racing past the resolver read and each inserting (R1 from Step 0).

- **New `IMemoryStore.atomicCreateOrFindByNormalizedName(input, scope)`** — atomic find-or-create keyed on `(type, normalizedDisplayName, scope)`. Returns `{entity, created}`. Both adapters implement.
  - **InMemory** — the find-phase scan runs synchronously over the in-memory map; the only `await` is the createEntity call inside which is also synchronous internally. Two concurrent invocations of `Promise.all(...)` can't both pass the find without one observing the other's insert.
  - **Mongo** — optimistic find-then-insert with E11000 duplicate-key recovery. Cross-process atomicity depends on the host installing the new unique partial index via `ensureNormalizedNameUniqueIndex`. The `isDuplicateKeyError` helper catches the race-loss; the loser re-queries and returns the winner.
- **New `MemorySystem.tryAtomicCreateOrResolve`** (private) — owner-required, coerces metadata dates, calls the adapter primitive, then on race-loss merges incoming aliases/identifiers/metadata onto the winner via `appendAliasesAndIdentifiers` (fillMissing default). Emits `entity.upsert` on the create path.
- **`EntityResolver.upsertBySurface`** swaps its create branch from `hooks.upsertEntity` to a new `hooks.atomicCreateOrResolve`. `UpsertBySurfaceResult.resolved` is now `true` for race-loss too — semantically equivalent to a resolver hit, and ExtractionResolver branches the same way for both.
- **New exported helper `ensureNormalizedNameUniqueIndex(entities, opts?)`** — host-controlled unique partial index on `{groupId, ownerId, type, normalizedDisplayName}` filtered by `{archived: {$ne: true}, normalizedDisplayName: {$exists: true, $ne: ''}}`. Re-exported from `@everworker/oneringai` and the memory barrel. **Not auto-installed** — see CHANGELOG body for the migration sequence (Commit 1 → Commit 6 backfill → dedup pass → install the unique index).
- **Resolver type-less queries** — `findEntitiesByNormalizedName(type, ...)` now accepts `type: string | undefined`. When undefined, the adapter matches across all types so `resolveEntity({surface})` without a type hint continues to work (used by `createSubjectResolver`).
- **Tests** — `tests/unit/memory/MemorySystem.atomicUpsert.test.ts` (10 tests including 20-way Promise.all convergence + race-loss alias/identifier/metadata merging). The R1 repro in `Dup.repro.test.ts` flips to assert convergence (was 2 entities pre-fix, now 1). 1201 memory + tool tests pass, 5666 total unit tests pass.

### Memory — Phase A Commit 2: EntityResolver Tier 2/3 indexed lookup

Replaces the substring-then-filter `searchEntities(q, {limit:50})` path in `EntityResolver.resolve()` with a single `findEntitiesByNormalizedName(type, normalized, scope, {matchAliases:true, limit:50})` call. Behavior-equivalent for well-typed callers; structurally immune to the Mongo `oversamplePool` cap that could drop an exact match outside the ranked top-50 under heavy substring fan-out.

- **`src/memory/resolution/EntityResolver.ts`** — Tier 2 + Tier 3 now resolve via the indexed adapter method. Tier confidences unchanged (0.90 displayName / 0.85 alias) — Commit 4 makes those configurable.
- **Type requirement** — the indexed path requires `query.type`. Type-less `resolveEntity` calls now skip Tier 2/3 (Tier 4 semantic still runs if enabled). All in-tree callers pass `type`; `UpsertBySurfaceInput.type` is already required.
- **Empty / pure-punctuation surfaces** — when `normalizeSurface(surface)` collapses to empty, Tier 2/3 is skipped (was already a no-op via `exactMatchTier`, but now we skip the adapter round-trip too).
- **Legacy data behavior** — entities written before 0.8.0 have no `normalizedDisplayName` and are NOT returned by the new lookup until `MemorySystem.backfillNormalizedFields` (Commit 6) runs. Documented in interface + new test.
- **Tests** — `tests/unit/memory/EntityResolver.indexedLookup.test.ts` (7 tests) including the bug-B repro (1 bare + 600 prefixed → bare resolves at 0.90). The pre-existing R3 repro in `Dup.repro.test.ts` continues to pass.

### Memory — Phase A Commit 1: normalized-name fields + adapter API (foundation)

Foundation for eliminating intra-user entity duplicates (R1 concurrency / R2 alias-tier / R3 substring-cap / R4 bare-upsertEntity). This commit is **additive only** — zero caller-observable behavior change in resolver or upsert paths. Lib-2 (resolver swap) + lib-3 (atomic upsert + unique index) build on this.

- **New `IEntity.normalizedDisplayName?: string` + `IEntity.normalizedAliases?: string[]`** (`src/memory/types.ts`) — indexable normalized form of the entity's `displayName` / `aliases`, populated automatically by both adapters from this version on. Optional on the interface only because pre-0.8.0 entities don't carry them; the upcoming backfill helper (Commit 6) populates legacy data.
- **New `computeNormalizedFields` helper** (`src/memory/normalize.ts`) — single source of truth, reuses `normalizeSurface` from `resolution/fuzzy.ts` so resolver matching and storage stay in lockstep. Empties dropped, normalized aliases deduped (first-seen wins).
- **Adapter-layer stamping** — `InMemoryAdapter.createEntity` / `updateEntity` and `MongoMemoryAdapter`'s shared `normalizeEntityForStorage` / `normalizeNewEntityForStorage` call `computeNormalizedFields` on every write. Spreads like `{...existing, displayName: 'new'}` cannot smuggle a stale normalized value through.
- **MemorySystem-layer stamping** — `createEntity`, the `upsertEntity` merge path, `appendAliasesAndIdentifiers`, `mergeEntities`, plus the two `createDocument` / `updateDocument` displayName-mutation paths recompute and attach normalized fields on the in-memory entity that is emitted to `entity.upsert` listeners and returned to callers. Belt-and-suspenders with the adapter stamping.
- **New `IMemoryStore.findEntitiesByNormalizedName(type, normalized, scope, opts?)`** — O(1) indexed exact-match lookup, with optional `matchAliases` to widen to `normalizedAliases`. Empty `normalized` returns `[]` (avoids over-matching legacy data). Default `limit` 20. Both adapters implement.
- **Mongo indexes** (`src/memory/adapters/mongo/indexes.ts`) — added `memory_ent_norm_name` (`{groupId,type,normalizedDisplayName}`) and `memory_ent_norm_aliases` (`{groupId,type,normalizedAliases}`, sparse), both `background: true`. The collection-like `createIndex` option type was widened to accept `background`, `sparse`, `partialFilterExpression` (RawMongoCollection + MeteorMongoCollection pass-throughs updated).
- **Tests** — new `tests/unit/memory/MemorySystem.normalizedName.test.ts` (17 tests covering helper + every MemorySystem stamping path + every find-method contract). `InMemoryAdapter.test.ts` extended with adapter-level `findEntitiesByNormalizedName` cases. Mongo integration test extended with Commit 1 stamping + find checks.
- **No CHANGELOG version bump yet** — released as 0.8.0 at the end of Phase A (Commit 6).

### Memory — Predicate consolidation round 2 (BREAKING)

Nine more predicates deleted — pure duplicates of entity metadata that survived round 1. The entire `temporal` category is removed.

- **Deleted predicates** (`src/memory/predicates/standard.ts`): `completed`, `created`, `reviewed`, `has_due_date`, `has_priority` (from `task` category — single-entity attributes already on `task.metadata`), `occurred_on`, `scheduled_for`, `started_on`, `ended_on` (entire `temporal` category — duplicates of `event.metadata.startTime` / `task.metadata.dueAt` / entity metadata). Standard set: **45 predicates across 10 categories** (down from 54/11).
- **Routing rule (now in prompt v8)**: every single-entity attribute lives on the entity. Completion → `task.metadata.state='done'`. Due date → `task.metadata.dueAt`. Priority → `task.metadata.priority`. Creation → `entity.createdBy` + `createdAt`. Scheduling → `event.metadata.startTime` / `task.metadata.dueAt`. Only **relationships between two entities** remain as task-category facts: `committed_to`, `prepares_for`, `blocked_by`, `depends_on`, `cancelled_due_to`.
- **Default extraction prompt bumped to v8** (`src/memory/integration/defaultExtractionPrompt.ts`). The "Tasks and events are entities with metadata" guidance now lists every duplicate-attribute case and the surviving relational task predicates.
- **Migration**: callers persisting any of these 9 names in legacy data must either migrate or accept that `PredicateRegistry.canonicalize` returns the raw string when the predicate isn't registered. Combined with round 1, that's **15 deleted predicates** to be aware of.

### Memory — Predicate consolidation round 1 (BREAKING)

Six standard predicates were deleted outright — their information lives more naturally on entity metadata or on the new first-class `decision_made` predicate. `state_changed`'s LLM auto-routing through `transitionTaskState` is gone with it; task state transitions are now host-driven via `MemorySystem.transitionTaskState`.

- **Deleted predicates** (`src/memory/predicates/standard.ts`): `approved`, `assigned_task`, `delegated_to`, `state_changed`, `has_status`, `current_status`.
- **New `decision_made` predicate** (`decision` category) — first-class capture of decisions, approvals, vendor selections, scope cuts, multi-party agreements. Subject = decider (person) OR venue (event/topic); value = verbatim decision. Subsumes the deleted `approved`.
- **Removed `state_changed` LLM auto-routing** (`src/memory/integration/ExtractionResolver.ts`) — the `tryRouteTaskTransition` branch and `MemorySystemConfig.autoApplyTaskTransitions` config are gone. Hosts that want LLM-observed state changes must read mention `metadata.state` (on creation) or call `MemorySystem.transitionTaskState` themselves.
- **`transitionTaskState` no longer writes an audit fact** (`src/memory/MemorySystem.ts`) — `metadata.stateHistory` is the only audit trail. `TransitionTaskStateResult.fact` and `TransitionTaskStateOptions.factOverrides` are removed.
- **Migration**: callers persisting deleted predicate names in legacy data must either migrate or accept that `PredicateRegistry.canonicalize` returns the raw string when the predicate isn't registered.

### Connectors — `ipinfo.io` geolocation connector + query-param API-key flow

Replaces the never-shipped `ipapi.co` template with `ipinfo.io` (Bearer-token auth on the `/lite/{ip}` and `/{ip}` endpoints). The supporting infrastructure for query-param API-key auth landed at the same time so future "key in `?key=...`" vendors get first-class treatment.

- **New vendor template** (`src/connectors/vendors/templates/geolocation.ts`) — `ipinfo` with `serviceType: 'ipinfo'`, `baseURL: 'https://api.ipinfo.io'`, Bearer-token API-key auth. Registered in `vendors/templates/index.ts` and `domain/entities/Services.ts`. Vendor registry regenerated.
- **Query-param API-key auth** (`src/core/Connector.ts`) — when `APIKeyConnectorAuth.queryParamName` is set, `Connector.fetch()` injects the token into the URL's search params and skips the auth header entirely. `buildAuthConfig` (`vendors/helpers.ts`) propagates the field through from vendor `defaults`.
- **Auth-key URL scrubbing for logs** — new private `scrubAuthQueryParam()` on `Connector` redacts the key value on `logRequest` / `logResponse` / error-log paths so secrets never leak to log sinks even when the caller passes a URL that already carried it.

### Connectors — Google OAuth scope set tightened

- Added `gmail.compose` (Create and update Gmail drafts).
- Removed `admin.directory.user.readonly` (was unused; required tenant-admin consent and blocked self-serve grants).

### Tools — Microsoft Graph `graphDateTimeToUtcIso` + connector helpers

Microsoft Graph returns calendar datetimes as naïve strings (`"2026-05-22T11:00:00.0000000"`) with the IANA zone in a parallel `timeZone` field — no `Z` suffix, no offset. Downstream consumers that assumed "no Z = UTC" silently shifted times by the local offset, producing display bugs (an 11:00 Berlin meeting rendering as 13:00).

- **New `graphDateTimeToUtcIso(dateTime, timeZone)`** in `src/tools/microsoft/types.ts` — converts Graph's `{dateTime, timeZone}` pair to an unambiguous UTC ISO 8601 string ending with `Z`. DST-correct via `Intl.DateTimeFormat`. Idempotent on strings that already carry `Z` or an offset.
- Wired through `findMeetingSlots`, `getMeeting`, `listMeetings` — every place where Graph hands the library a calendar `start`/`end`.

### Tools — Google Calendar adapter fix (`getGoogleCalendarUserId`)

Google Calendar's `calendars.events.*` endpoints reject `'me'` as a calendar identifier (404 — the documented reserved keyword for the authenticated user's primary calendar is `'primary'`). Previous code shared `getGoogleUserId` between Gmail and Calendar paths, so delegated-OAuth calendar calls were silently failing.

- **New `getGoogleCalendarUserId(connector, targetUser, actAs)`** in `src/tools/google/types.ts` — returns `'primary'` for delegated OAuth, falls back to the existing service-account behavior. Wired into `createMeeting`, `editMeeting`, `getMeeting`, `listMeetings`.

### Memory — Predicate lifecycle policy + standard-predicate expansion

Every standard predicate now carries a `lifecycle` tag (`'stable' | 'stateful' | 'observation' | 'commitment' | 'communication' | 'decision'`) plus optional `defaultValidityDays`. `MemorySystem.addFact` auto-stamps `validUntil` from `defaultValidityDays` so old commitments / observations / per-message comms naturally expire while identity, structural, and decision facts remain.

- **New `PredicateLifecycle` type** in `src/memory/predicates/types.ts` (~60 lines).
- **`STANDARD_PREDICATES` annotated** with lifecycle tags (`src/memory/predicates/standard.ts`, ~135 lines added) — identity/structural → `stable`, role/status → `stateful`, comms (`emailed`, `cc_ed`, `mentioned`, `responded_to`, `noted`, `acknowledged`, `interaction_count`) → `communication` + tagged `excludeFromExtractionPrompt: true` so the default extraction prompt no longer advertises them to the LLM (per-message metadata belongs in aggregation, not in the extracted-fact stream).
- **`PredicateRegistry.renderForPrompt`** updated (sort fix lives in the Pagination section above).
- **Tests:** 352 new lines in `tests/unit/memory/MemorySystem.lifecycle.test.ts` covering auto-`validUntil` stamping, lifecycle inheritance through `addFact`, and prompt-exclusion of `communication` predicates.

### Memory — Entity-anchored cross-source reconciliation (Pillar 2)

Distinct from the per-thread reconciliation already in `defaultExtractionPrompt` (Pillar 1, paired with new signal content). Pillar 2 shows the LLM **ALL non-archived facts on ONE entity** (regardless of source) and asks it to find genuine conflicts. Output schema is the same `operations` array as the default prompt, restricted to `update` / `archive` only — Pillar 2 reconciles, it never creates.

- **New `entityReconciliationPrompt(ctx)`** + `ENTITY_RECONCILIATION_PROMPT_VERSION = 1` in `src/memory/integration/entityReconciliationPrompt.ts` (~185 lines). Groups facts by `(predicate, objectIdKey)` so conflict candidates are clustered for the LLM.
- **`EntityReconciliationPromptContext`** + `ReconciliationOp` + `OperationOutcome` + `SignalThreadMessage` exported from `@everworker/oneringai` and `./memory`.
- **`ExtractionResolver`** extended (~352 lines added across this and the next section) — entity resolution against pre-existing entities via canonical-id + identifier matching for `event` mentions (cross-signal calendar/transcript ingestion now converges on one entity instead of fanning out duplicates).

### Memory — Extraction prompt: date discipline + primary-evidence grounding

The default extraction prompt and the `SessionIngestorPluginNextGen` session-extraction prompt were silently letting the LLM invent `validUntil` dates from the prompt's "Reference date" header whenever the source used a relative anchor like "today" / "Friday" / "next week". That decays the moment the fact is written and silently rewrites history on re-extraction.

- **`defaultExtractionPrompt.ts`** (+172 lines) — explicit date discipline: ISO-only in `value`/`details`/`validUntil`; never resolve a relative anchor against the Reference date; if the source can't pin the date to primary evidence (a `[tool_result]`, calendar event, email `Date:` header, etc.), strip the date phrase and keep the fact dateless, or omit it.
- **`SessionIngestorPluginNextGen.ts`** (+66 lines) — same rules in the session-ingestion prompt, plus a "Primary-evidence grounding" section that splits facts into Class A (interactional / about-the-user) vs Class B (world claims about third-party entities) and refuses to extract Class B claims grounded only in the agent's own narrative / synthesis.
- **`parseExtraction.ts`** (+75 lines) — tolerant of the new `operations` shape; never throws on malformed reconciliation ops, surfaces them in `IngestionResult.errors` instead.

### Memory — `recall` tool now passes entity `metadata` through

`memory_recall` was returning entity `displayName`, `aliases`, `identifiers` but stripping `metadata` from the primary entity view (the omission was already fixed for `relatedTasks[*].metadata` and `relatedEvents[*].metadata` — this closes the asymmetry). Agents calling provider tools were forced to reconstruct ids from the canonical identifier (lossy) instead of reading the verbatim provider id from `metadata.jarvis.source.externalId`.

- `src/tools/memory/recall.ts` — `entity.metadata` now passed through verbatim.

### Memory — Routine pre-step plugin bootstrap (`IContextPluginNextGen.prepare()`)

The routine runner's pre-steps execute deterministically before the first LLM turn. Plugins that resolve lazy state on first `getContent()` (e.g. `MemoryPluginNextGen` bootstrapping `userEntityId` / `agentEntityId` / `groupEntityId`) were still in pre-bootstrap state when a pre-step invoked one of their tools, so identity tokens like `subject: 'me'` failed with "no user scope".

- **New optional `prepare?(): Promise<void>`** on `IContextPluginNextGen` — contract: "make sure your lazy state is ready before any tool you contribute is invoked". `src/core/context-nextgen/types.ts` (+19 lines).
- **`MemoryPluginNextGen.prepare()`** (+21 lines) — idempotent wrapper around `ensureBootstrapped()`. Safe to call multiple times.
- **`routineRunner.ts`** (+36 lines) — drives `await Promise.all(plugins.map(p => p.prepare?.()))` after the agent is built and before pre-steps fire. Errors are logged but don't abort the routine — the LLM turn will still trigger bootstrap naturally.

### Routines — `disableToolScoping` opt-out

Routines normally call `existingAgent.scopedTo(definition.requiredTools, ...)` so the LLM only sees the tools the routine actually needs. Some routines have preSteps / postSteps that use tools the LLM tasks don't need (e.g. internal context-loading) — listing every such tool in `requiredTools` would be misleading.

- **New `ExecuteRoutineOptions.disableToolScoping?: boolean`** (default `false`) — when `true`, skip the `scopedTo()` step. `requiredTools` is still validated as a "must be present" gate; the flag only disables runtime restriction of the toolset.
- `src/core/routineRunner.ts` (+45 lines).

### Memory — Mongo archive collection indexing

Move-on-archive deployments (`MeteorMongoCollection` with separate `archive` collection) were degrading to collection scans on `findFacts({archived: true})` / `countFacts({archived: true})` / `getFact(id)` archive-fallback as the archive grew.

- **`EnsureIndexesArgs.factsArchive?`** (`src/memory/adapters/mongo/indexes.ts`, +98 lines) — when provided, the same subject/object/context/predicate-led indexes are built on the archive collection. Legacy `groupId+ownerId`-led compounds are NOT mirrored — the archive isn't on the hot path for admin tooling.
- **Identifier-led index `memory_ent_ident_only`** — the access `$or` (ownerId / groupId-eq / groupId-`$ne`) can never pin `groupId+ownerId` as a leading equality across all three branches, so `memory_ent_ident` falls back to wide scans on the world branch. Identifier-led variant works for every branch.
- **Subject/object/context-led fact indexes** — `memory_fact_subject_observed`, `memory_fact_object_observed`, `memory_fact_context_observed`, `memory_fact_subject_pred_observed`. Each leads with the highly-selective key directly so the planner uses the SAME index for ALL three access-`$or` branches. Empirically turns 530-second, 58k-doc-examined queries into millisecond seeks. Legacy `groupId`-led compounds retained for admin tooling.
- **`MongoMemoryAdapter`** (+261 lines), `MeteorMongoCollection` (+19 lines), `queries.ts` / `scopeFilter.ts` (+~50 lines) — archive collection wiring, `archived: true` query routing, and scope-filter access-$or normalization.
- **Tests:** 256 lines in `MongoMemoryAdapter.test.ts`, 82 lines in `MeteorMongoCollection.test.ts`, 43 lines in `scopeFilter.test.ts`.

### Memory — Pagination without silent caps (L0 sort fixes + L1 iterators + L2 truncation warnings)

Closes a class of silent data-loss bugs where read APIs returned items in adapter insertion order ("first N rows of the table") under the guise of relevance. The cap pretended to keep "the most relevant" but actually kept "the first stored." LLM context (related tasks, related events, predicate vocabulary) was biased by storage position, not by what the caller asked for.

**L0 — Sort fixes (correctness):**
- `resolveRelatedTasks` (`MemorySystem.ts:2089`) — every internal `listEntities` + `findFacts` now passes `orderBy`. Per-role queries sort `[metadata.dueAt asc nulls-last, updatedAt desc, id asc]`; fact-context fallback sorts `observedAt desc`. Final dedup'd values sorted by `compareTaskByDueThenRecency` before the slice so cross-source merge order doesn't bias by source.
- `resolveRelatedEvents` (`MemorySystem.ts:2153`) — first-tier `listEntities({type:'event'})` now sorts `[metadata.startTime desc, id asc]` so the most-recent events survive the 200-cap (previously: insertion-order, so a meeting tomorrow could be dropped while a 89-day-old one stayed). Fact-context + tier-3 `attended`/`hosted` fact queries sort `observedAt desc`. Final dedup'd values sorted by `compareEventByWhenDesc`.
- `getContext` topFacts (`MemorySystem.ts:1853`) — over-fetch ratio bumped from `3×` to `10×` (new `TOP_FACTS_OVERFETCH_MULTIPLIER` constant). The in-memory ranker now sees 150 candidates (default 15 × 10) before slicing to 15, so high-importance facts at storage positions 16-149 actually reach the ranker.
- `PredicateRegistry.renderForPrompt` — each category now sorted by `(defaultImportance desc, name asc)` before `.slice(0, maxPerCategory)`. Highest-importance predicates within each category survive the cap; ties broken by name for stability.

**L0 — Adapter contract hardening:**
- `MongoMemoryAdapter.listEntities` + `findFacts` and `InMemoryAdapter.listEntities` + `findFacts` now emit a one-time `console.warn` when called with `limit` set but no `orderBy`. Without a sort, the adapter falls back to insertion order (Mongo `_id` asc, InMemory `Map.values()` iteration) — that's silent, position-biased truncation. The warning includes a stack trace pointing at the offending caller. Suppress with env var `ONERINGAI_SUPPRESS_ORDER_WARNINGS=1`.

**L1 — Async iterators (no silent caps, ever):**
- Four new methods on `MemorySystem` for callers that need EVERY matching row (audit sweeps, status refresh, backfills) rather than a bounded slice:
  - `iterateOpenTasks(scope, {assigneeId?, projectId?, batchSize?, startAfter?})` — yields IEntity[] batches via cursor pagination. Sort matches `listOpenTasks`. Default `batchSize: 200`, max 1000. Pass `startAfter` cursor to resume a long-running job from a checkpoint.
  - `iterateRecentTopics(scope, {days?, batchSize?, startAfter?})` — sort `updatedAt desc`; early-terminates once a batch contains topics older than the window.
  - `iterateEntitiesByFilter(filter, scope, {batchSize?, startAfter?, orderBy})` — generic entity iteration; caller MUST pass orderBy.
  - `iterateFacts(query, scope, {batchSize?, startAfter?, orderBy})` — generic fact iteration; caller MUST pass orderBy.
- The existing flat-array `listOpenTasks` / `listRecentTopics` are unchanged in signature; new iterators are additive.

**L2 — Truncation warnings on flat-array list methods:**
- `listOpenTasks` and `listRecentTopics` now emit a `console.warn` when their result length equals the requested limit AND the underlying page has `nextCursor` set (i.e., more rows exist that were dropped). Recommends the matching `iterateX` for full-coverage cases. Suppress with `ONERINGAI_SUPPRESS_CAP_WARNINGS=1` for genuine prompt-budget callers. The warning attribute uses the USER-facing result count + user's `limit` (not the internal over-fetch ceiling) so the message accurately reflects what the caller sees.

**Internal cleanup (DRY / KISS):**
- Shared `makeEnvFlag()` helper in `src/memory/envFlag.ts` — single source of truth for the cap/order warning suppression pattern (cached env-var read + test-only reset).
- `OPEN_TASK_ORDER_BY` module-level constant — used by `listOpenTasks`, `iterateOpenTasks`, and `resolveRelatedTasks` per-role push-down. Previously each of the three sites declared its own array; the `iterateOpenTasks` array had an `id asc` tiebreak that `listOpenTasks` didn't, so the docstring claim "Same as listOpenTasks" was slightly wrong. Now genuinely identical.
- Named cap constants: `RELATED_FACT_FETCH_LIMIT` (200), `RELATED_PREDICATE_FACT_LIMIT` (100), `RECENT_TOPICS_OVERFETCH_MULTIPLIER` (4), `RECENT_TOPICS_OVERFETCH_CEILING` (200). Replaces the magic `200` / `100` / `4` literals scattered across `resolveRelatedTasks`, `resolveRelatedEvents`, and `listRecentTopics`.

**Tests:**
- New `tests/unit/memory/MemorySystem.pagination-no-silent-caps.test.ts` — 18 tests covering sort regression (overdue/soonest-due wins under cap; recent events win under cap; predicate importance ordering), iterator coverage (500 tasks via cursor; dueAt-asc-nulls-last across batches; filter honored; empty set), and adapter + cap warning fire/suppress paths.
- One existing test updated: `MemorySystem.lifecycle.test.ts` `includeExcluded: true surfaces them` now passes `maxPerCategory: 50` because `mentioned` (importance 0.3) correctly drops below `met_with` (0.6) and the 0.4-tier predicates under the default cap of 5 — the test was implicitly relying on the broken insertion-order sort.

**Not in scope (filed as separate follow-ups):**
- `defaultExtractionPrompt.ts` prompt-budget caps (40 entities, 2 aliases, 5 examples) — legitimate token-budget controls; document, don't change.
- `DEFAULT_EMBED_SOURCE_CHAR_LIMIT = 32_000` (`MemorySystem.ts`) — embeddings miss content past 32k chars; separate plan.
- `DEFAULT_STATE_HISTORY_CAP = 200` on task `metadata.stateHistory` — write-side cap with documented escape hatch (the `state_changed` fact graph keeps full history); not a read-API issue.
- Pushing `metadata.startTime` range filter into adapter `metadataFilter` so `resolveRelatedEvents` doesn't have to apply the 90-day window client-side after the 200-cap.

### Memory — Documents (long-form work artefacts)

Documents are now a first-class concept in the memory layer — entities with `type='document'` carrying long-form content in `metadata.body`. Pure convention over the existing `IEntity` / `IFact` model: same storage, same permissions, same scope filtering. Agents create / update / attach / search documents using the existing entity + fact tools plus **one new read tool** (`memory_search_documents`). Six gaps closed; no new collections.

- **Conventions** (`src/memory/documents/types.ts`) — `type='document'`, `metadata.body` (string), `metadata.role` (free string: `brief` | `plan` | `transcript` | `spec` | `notes` | `artifact` | ...), `metadata.format` (default `markdown`), `metadata.summary` (optional; preferred embedding source), `metadata.byteSize` (derived). Slugs are stored as `{kind:'canonical', value:'doc:<slug>'}` so `getDocument('q3-brief')` and `getDocument('doc:q3-brief')` resolve to the same entity.
- **New `contentEmbedding` field on `IEntity`** — distinct from `identityEmbedding` so semantic content matches never leak into EntityResolver's identity tier. Embedded from `title + (summary ?? body.slice(0, 32_000))` on create/update; queued via existing embedding queue (`EmbeddingQueue.enqueueContent`).
- **`IMemoryStore.semanticSearchEntities` extended** with an `embeddingField: 'identity' | 'content'` option (default `'identity'` — backward compatible). Adapters MUST strictly honor the requested field — no silent fallback to the other embedding. Both InMemoryAdapter and MongoMemoryAdapter updated.
- **MongoMemoryAdapter — `entityContentVectorIndexName` config + opt-in 2nd entity vector index.** `ensureVectorSearchIndexes()` creates the `contentEmbedding` index **only when** the caller passes `entitiesContentIndexName` explicitly OR the adapter was constructed with `entityContentVectorIndexName` set (default: skip, so existing deployments don't get a surprise Atlas index when they re-run the migration). `ENTITIES_FILTER_PATHS` gained `metadata.role` so role-scoped doc queries actually work on the `$vectorSearch` fast path (Atlas silently ignores filters whose paths aren't declared as `filter`).
- **New canonical predicate `has_document`** in `STANDARD_PREDICATES` (category `document`, `excludeFromExtractionPrompt: true`). Single attachment predicate for every kind of document; distinguish by the doc's own `metadata.role`. Inverse `document_of`, aliases `has_doc` / `attached_document`.
- **`MemorySystem` API (7 typed wrappers):** `createDocument({title, slug?, body, role?, format?, summary?, metadata?, attachTo?, ...})` — true upsert by slug (collision refreshes body/role/title via `metadataMerge:'overwrite'`); **pre-flight slug-collision check** rejects squatters BEFORE the upsert runs, leaving non-document entities untouched (earlier draft applied `metadataMerge:'overwrite'` first and threw only after the squatter's metadata had been corrupted + version bumped). `updateDocument(idOrSlug, {body?, role?, format?, summary?, metadata?, aliases?, title?})` (mutable, latest-only; body change queues content-embedding refresh). `getDocument(idOrSlug)`. `attachDocument(parentId, docIdOrSlug)` (idempotent via `addFact({dedup:true})`). `detachDocument(parentId, docIdOrSlug): {archived, skippedDueToPermissions}` (archives every matching `has_document` fact in scope; return shape distinguishes "no matches" from "matches denied by permissions"). `listDocuments({attachedTo?, role?, ownerId?, includeBody?, ...})` (strips `metadata.body` by default — opt-in via `includeBody:true`). `searchDocuments({query, mode:'semantic'|'keyword', attachedTo?, role?, limit?})` — **`attachedTo` resolved up front** to a bounded set and scored directly (avoids semantic top-K starvation and bypasses the keyword pagination cap); **keyword path paginates through all visible docs** with a 10K hard safety cap + loud `console.warn` on hit (no more silent first-page-1000 truncation); semantic over-fetches 5× when `role` is set so the JS post-filter doesn't starve results; keyword collects-all-then-sorts so name hits never get displaced by body hits seen earlier in the page.
- **`createDocument` displayName updates queue identity-embedding refresh** — when an existing slug resolves with a different title, the follow-up `updateEntity` now calls `queueIdentityEmbedding` so EntityResolver's semantic tier doesn't keep matching the prior title.
- **New LLM tool `memory_search_documents`** in the read bundle (`createMemoryReadTools` → 6 tools, `createMemoryTools` → 12 tools). Semantic mode uses `contentEmbedding`; keyword mode is case-insensitive substring over `metadata.body` + `displayName`, fully paginated with a 10K hard cap. Returns `{results: [{doc, score, snippet, matchedVia}]}`; clamps `limit` to `[1, 50]`; resolves `attachedTo` SubjectRef before any candidate fetch.
- **Plugin instructions extended (no new plugins):** `MemoryPluginNextGen.READ_INSTRUCTIONS` gains a "Documents" section explaining how to find / get / list / search docs via existing tools. `MemoryWritePluginNextGen.WRITE_INSTRUCTIONS` gains the matching write conventions — create via `memory_upsert_entity` with `type:'document'` + `metadata.body`, update with `metadataMerge:'overwrite'`, attach via `memory_link` with `predicate:'has_document'`, delete via `memory_forget`.
- **New tests:** `tests/unit/memory/MemorySystem.documents.test.ts` (34 — incl. slug-collision upsert, displayName-on-resolve, non-document-squatter rejection + **no-side-effect regression guard**, keyword sort correctness, detach return-shape, **keyword pagination past 1000 docs**, **attachedTo bounded-set starvation guards** for keyword + semantic), `tests/unit/tools/memory/searchDocuments.test.ts` (8), `tests/unit/memory/InMemoryAdapter.contentEmbedding.test.ts` (4), plus updates to factory-split and Mongo-adapter index tests reflecting the 6/12 tool count and the opt-in 2nd entity vector index. All 5570 unit tests pass.

## [0.6.1] - 2026-05-14

### OAuth — `RefreshStrategy` per vendor template (registry-init validated)

Closes the silent-refresh-token-loss class of bugs once and for all. Every `authorization_code` template must now declare how the vendor issues refresh tokens, and the library force-merges whatever the strategy demands into authorize URLs — so operators can override scopes / `authorizationParams` without breaking long-lived sessions.

- **New `RefreshStrategy` discriminated union** on `AuthTemplate.refreshStrategy` (`src/connectors/vendors/types.ts`): `{kind:'scope', scope}` | `{kind:'auth_param', key, value}` | `{kind:'automatic'}` | `{kind:'never_expires'}` | `{kind:'manual_setup', description}`. Required for `flow === 'authorization_code'`; `initVendorRegistry` **throws** at boot if any auth-code template is missing it.
- **Force-merge semantics** — `buildAuthConfig`/`applyRefreshStrategy` merge the required scope/param **without clobbering operator-set keys** (operator scope additions are kept; the refresh-grant token is appended). The strategy also stamps `requiredScope` onto `OAuthConnectorAuth` so DB-reconstituted connectors re-apply it.
- **`Connector.setRefreshStrategyBackfill(...)`** — registered automatically by `vendors/index.ts` at import time. `initOAuthManager` looks up the vendor template by `serviceType` and re-applies the strategy whenever a persisted `OAuthConnectorAuth` lacks `requiredScope`. **No migration needed for existing saved connectors** — the upgrade is self-healing.
- **Per-vendor refresh strategies wired** — Microsoft / Atlassian / GitLab → `scope: 'offline_access'`; Salesforce → `scope: 'refresh_token'`; Twitter/X → `scope: 'offline.access'` (dot, not underscore!); Google → `auth_param: access_type=offline`; Dropbox → `auth_param: token_access_type=offline`; Discord / Asana / HubSpot / Stripe / QuickBooks / Box / Zoom / Pipedrive / Ramp / Bitbucket / Airtable / GitLab / PagerDuty / Sentry → `automatic`; Notion / Linear / Slack / Trello / Mailchimp / Zendesk / Intercom / Shopify / GitHub OAuth Apps → `never_expires`; GitHub App / Slack-rotation → `manual_setup` with operator instructions.
- **Defensive backfill on `OAuthConnectorAuth.requiredScope`** survives encryption/decryption — spread-preserved by `ConnectorConfigStore`. Hosts that bypass `buildAuthConfig` (e.g. v25's `GroupScopedConnectorRegistry`) get the right behavior via the registered backfill.
- **`applyRefreshStrategy` exported** for advanced callers; `extractNonSecretCredentials` polish; vendor registry completeness test ensures no auth-code template ever ships without a strategy.
- New tests in `tests/unit/connectors/vendorHelpers.test.ts` (285 lines), `tests/unit/connectors/vendorRegistryCompleteness.test.ts`, and `tests/unit/oauth/AuthCodePKCE.test.ts` (90+ new lines) covering all five strategy kinds, operator scope-override preservation, backfill correctness, and registry-init failure mode.

### OAuth — `ClientCredentials` + `JWTBearer` flows: shared `TokenStore` semantics

App-token (machine-to-machine) flows now follow the same persistence contract as user OAuth flows. Tokens issued by client-credentials or JWT-bearer grants are stored, refreshed proactively, and shared across processes via `TokenStore`.

- `ClientCredentials.ts` and `JWTBearer.ts` rewritten to delegate token lifecycle to `TokenStore` (was: ad-hoc per-flow caching). Fixes silent re-fetching on every call when running concurrent agents against the same connector.
- `TokenStore.ts` — minor invariants tightened (audit fact on issue + refresh; expiry skew kept conservative).

### Memory — `memory_list_facts` accepts `sourceSignalId`; "all facts from one signal" mode

Lets callers pull every fact that came out of a specific email / meeting transcript / calendar event, without first resolving the signal to a subject entity. Useful for audit trails, signal-level rebuild, and grounding answers to "what did we agree in the Q3 review?".

- **`subject` is now optional** when `sourceSignalId` is given; both can also be combined to AND the two filters. At least one is required (validated in `execute()`, not via JSON-schema `required`).
- **New `FactFilter.sourceSignalId` field** propagated through `MemorySystem.listFacts` and both adapters (InMemory + Mongo). Opaque id — the embedding app owns signal-id resolution.
- Tool description updated with the three modes (subject only / signal only / both) and examples; pass `kind: 'any'` to include narrative-style memos.

### Memory — persona-aware system-message rendering

`MemoryPluginNextGen` now supports a `persona: PersonaConfig` config object that lets the renderer adapt user/agent block headers, profile wording, and instruction copy to a different addressing mode without forking the plugin. Used by Everworker Desktop's "Jarvis" persona; safe to ignore for default agents (no behavior change when `persona` is unset).

- New `PersonaConfig` type exported from `@everworker/oneringai`, `core/context-nextgen`, and `core/context-nextgen/plugins`.
- New tests in `MemoryPluginNextGen.persona.test.ts` (193 lines) covering header substitution, fallback behavior, and 1st/3rd-person framing under custom personas.

### Tools — `request_user_input` interaction tool

New built-in tool for routines / orchestrator workflows that need to pause and ask the user for structured input (single-select, multi-select, free-text, file upload). Returns the response synchronously from the agent's perspective; host apps render the prompt and call back via `Agent.inject()`.

- Files: `src/tools/interaction/requestUserInput.ts` (281 lines), `src/tools/interaction/types.ts` (145 lines), `src/tools/interaction/index.ts` (registered into the auto-registry as the `interaction` category).
- Auto-registered in `registry.generated.ts`; the `interaction` category is added to the canonical `ToolCategory` union.
- 197 lines of unit tests covering schema validation, timeout behavior, malformed-response handling, and integration with `Agent.inject()`.

### Memory — `ExtractionResolver` event-resolution improvements

`ExtractionResolver` now resolves `event` mentions against pre-existing entities via canonical-id + identifier matching (was: blind upsert on every re-extraction). Cross-signal calendar/transcript ingestion now converges on a single event entity instead of fanning out duplicates.

- 158 lines added to `ExtractionResolver.ts`; 313 lines of new tests in `tests/unit/memory/integration/ExtractionResolver.test.ts` covering re-ingestion idempotency, identifier-based merge, and the new event-resolution path.

### Memory — priority entity write path tightened

`memory_upsert_entity` now accepts the priority-specific metadata shape (`metadata.jarvis.priority.{status, weight, horizon, deadline, scope}`) and validates it before persisting, so the rendered `## User's Active Priorities` block can rely on every field being well-formed. Cleanup pass on `MemoryPluginNextGen` + `MemoryWritePluginNextGen` priority handling.

### Memory — `MemoryEntry.description` raised from 150 → 500 chars

`DEFAULT_MEMORY_CONFIG.descriptionMaxLength` bumped from 150 to 500. The 150-char ceiling was forcing the LLM to write cramped, often-useless index entries; the index hit modest token-budget pain at 500 in exchange for a meaningful jump in retrieval quality. `WorkingMemoryAccess.store(...)` docstring updated accordingly. No format change — pre-existing entries are unaffected.

### Memory — entity listing date coercion

`MemorySystem.listEntities` now runs the same date-coercion pass on `metadata` filter values that `upsertEntity` does on writes. Fixes a class of bugs where a caller passing `metadata: { dueAt: new Date(...) }` would silently miss entities whose `dueAt` is stored as an ISO string (or vice versa) because the equality check was structural.

- 22 new lines in `dateCoercion.ts`; coercion added in both adapters (`InMemoryAdapter`, `MongoMemoryAdapter`); 129 lines of new tests in `MemorySystem.listEntities.dateCoercion.test.ts` covering Date↔string parity across both stores.
- Polish on `findEntity` to use the same coercion helper.

### Memory — extraction-prompt no-truncation pass

`SkepticPass.ts` and `defaultExtractionPrompt.ts` were quietly trimming long mentions / facts before the LLM call. Per the project-wide no-truncation policy (modern LLMs have 200k–1M ctx; truncation silently destroys information), these caps are removed. Callers that need a hard cap can batch upstream.

### Agent — `scopedTo()` now inherits parent permissions

`Agent.scopedTo(toolNames, options)` now propagates the parent's `_config.permissions` (autoApproveAll, allowlist, denylist, policy chain) verbatim onto the scoped sub-agent. Routine execution is autonomous — there is no interactive approval surface — so an `autoApproveAll` superagent must produce `autoApproveAll` scoped children. Previously, scoped sub-agents inherited an empty permission policy and would block on any non-`always`-scope tool call inside a routine.

### Routine builder — compact tool listing + builder improvements

- **`ToolManager.listCompact()`** — new method returning `{name, description, category?, connectorName?}` per enabled tool. Strips parameter schemas. Used by `routine_generate` / `routine_update` to discover available tools on the superagent without paying the token cost of full definitions.
- **`Agent.scopedTo()` honors `instructions` override** properly; routine runner improvements for control-flow execution paths; `generateRoutine.ts` cleanup.

### Desktop tools — mouse coordinates unified with screenshot pixel space (PR #7)

Fixes click drift on Retina / scaled-DPI displays. Mouse coordinates returned by `desktop_screenshot` are now guaranteed to match the coordinate space accepted by `desktop_mouse_click` / `desktop_mouse_move` / `desktop_mouse_drag` / `desktop_mouse_scroll` and reported by `desktop_get_cursor` — all in physical pixels, regardless of display scaling factor. `screenshotMaxDim` clarification added with explicit tradeoff documentation.

- Substantial refactor of `NutTreeDriver.ts` (~270 lines); coordinate normalization centralized; test coverage expanded in `tests/unit/tools/desktop/NutTreeDriver.test.ts` and `screenshot.test.ts`.

### Memory — kind-aware identifier-value case normalization (BREAKING for callers hand-rolling identifier queries)

Prior to this change, both Mongo and InMemory adapters unconditionally lowercased every `Identifier.value` at the storage boundary, regardless of `kind`. This was symmetric on the library's own paths (lookups also lowercased the query, so they matched), but it destroyed original case for case-sensitive identifier kinds — most importantly Meteor `Random.id()`-shaped values stored under custom kinds like `system_user_id`. Any caller hand-rolling a Mongo query against `identifiers[].value` would miss matches.

**Fix:** identifier value normalization is now **kind-aware**. Only kinds in the new `CASE_INSENSITIVE_IDENTIFIER_KINDS` set get lowercased on write and on lookup. All other kinds preserve original case end-to-end.

- **Case-insensitive (lowercase normalized):** `email`, `domain`, `phone`, `url_host`. Matches RFC 5321 (email), RFC 4343 (DNS) — universally safe.
- **Case-preserving (default for all other kinds):** `system_user_id`, `canonical`, `slack_id`, `github`, `ticker`, `duns`, hashes, tokens, and any caller-defined kind not explicitly in the case-insensitive set.

Touched files:
- `src/memory/identifiers.ts` — new exports `CASE_INSENSITIVE_IDENTIFIER_KINDS`, `normalizeIdentifierValue(kind, value)`, `identifierValuesEqual(kindA, valueA, kindB, valueB)`.
- `src/memory/adapters/mongo/MongoMemoryAdapter.ts` — three sites updated: `findEntitiesByIdentifier` lookup, `normalizeEntityForStorage`, `normalizeNewEntityForStorage`.
- `src/memory/adapters/inmemory/InMemoryAdapter.ts` — five sites updated: `findEntitiesByIdentifier` lookup, `indexEntity` and `unindexEntityIdentifiers` index keys, plus `createEntity` and `updateEntity` now normalize stored identifier values consistently with Mongo (previously they stored raw input — a behavioral inconsistency).
- `src/memory/MemorySystem.ts` — two dedup comparators (lines ~551 and ~2666) switched from raw `toLowerCase()` to `identifierValuesEqual`.
- `src/memory/identifierMigration.ts` — **new file**, exports `recaseIdentifierValues(store, options)`. One-shot migration helper for callers whose existing data has lowercased values for case-sensitive kinds. Caller supplies a recovery function that returns the original-case value (the library has no source of truth for what the original was — only the application does).

#### Migration

If your application previously stored case-sensitive identifier values (e.g. `system_user_id`, `canonical`, `slack_id`) under the old behavior, those values are still lowercased in your database. Lookups by original case now miss. Run `recaseIdentifierValues` once per tenant scope — example for Meteor user IDs:

```ts
import { recaseIdentifierValues } from '@everworker/oneringai';

await recaseIdentifierValues(store, {
  kind: 'system_user_id',
  scope: { userId: someUser, groupId: someGroup },
  recover: async ({ storedValue }) => {
    // Iterate Meteor.users to find the user whose _id matches case-insensitively.
    const u = await Meteor.users.findOneAsync({}, { fields: { _id: 1 } });
    // … your application logic — return the original-case string, or null to skip.
    return originalCaseUserId;
  },
});
```

Tests:
- `tests/unit/memory/identifiers.test.ts` — 14 new test cases covering the helper functions, end-to-end storage layer behavior, and the kind-aware dedup comparator.
- All 954 existing memory tests continue to pass.

### Connector tools — `actAs` lock for app-only / service-account flows

Closes the impersonation gap on Microsoft Graph and Google API tools. A single shared app-token connector can now be wired into a specific agent that operates ONLY on behalf of a given user, with no way for the LLM to point at a different mailbox / drive.

- **New `ConnectorToolsOptions.actAs?: string`** (and matching `AuthIdentity.actAs`) — set ONCE at tool instantiation. The connector itself stays generic; the lock lives on the tool instances handed to a specific agent.
- **Schema-level enforcement** — when `actAs` is set, the `targetUser` JSON-schema property is OMITTED from every URL-scoped Microsoft + Google tool. The LLM literally cannot express the disallowed call. Defense-in-depth: `getUserPathPrefix` / `getGoogleUserId` always prefer `actAs` over any LLM-supplied `targetUser` arg if one slips through.
- **Empty-string normalization** — `actAs: ''` and whitespace-only values are coerced to "unset". Lets host apps pass `actAs: process.env.DEFAULT_USER` without breaking when the env var is unset. Surrounding whitespace on `actAs` and `targetUser` is also trimmed.
- **Delegated connectors** also drop `targetUser` from their schemas (the OAuth token already binds identity; the arg was previously decorative and silently ignored).
- **Backward compatible**: existing `ConnectorTools.for(connector)` calls without `actAs` keep current behavior — app-only connectors still expose `targetUser` as a required-style arg.
- New `shouldExposeTargetUserParam()` and `TARGET_USER_PARAM_SCHEMA` helpers exported from both `src/tools/microsoft/types.ts` and `src/tools/google/types.ts`.
- New `ServiceToolFactoryOptions` interface exported from `src/tools/connector/ConnectorTools.ts` — third arg of `ServiceToolFactory` for forwarding `actAs` (and future settings). Existing factories that ignore the third arg continue to work.
- New unit tests in `tests/unit/tools/microsoft/actAsLock.test.ts` and `tests/unit/tools/google/actAsLock.test.ts` covering: helper resolution order, per-tool schema shape across all states, runtime URL with locked / unlocked / delegated connectors, defense-in-depth (LLM `targetUser` ignored when locked), `ConnectorTools.for({ actAs })` propagation, empty/whitespace-`actAs` normalization, and documentation tests for non-participating tools (proves the gap exists).

#### Scope — which tools participate

**Participating (`actAs` enforced at URL level)** — 16 tools whose request URL is user-scoped, so the lock fully constrains data scope:
- Microsoft: `send_email`, `create_draft_email`, `create_meeting`, `edit_meeting`, `get_meeting`, `get_meeting_transcript`, `list_meetings`, `find_meeting_slots`, `list_files`, `read_file` (URLs all built from `/me` or `/users/{id}`).
- Google: `send_email`, `create_draft_email`, `create_meeting`, `edit_meeting`, `get_meeting`, `list_meetings` (URLs built from `/gmail/v1/users/{id}/...` or `/calendar/v3/calendars/{id}/...`).

**Non-participating** — 6 tools whose endpoints are not user-scoped at the URL level. They do NOT take `actAs`, the lock has no effect on them, and they always work with whatever the underlying token can see (i.e. respect the token's normal permissions). Each carries a `NOTE on actAs lock` doc block:
- Microsoft `search_files` — tenant-global `/search/query` (or site-scoped `/sites/{id}/...` when `siteId` is given).
- Google `list_files`, `search_files`, `read_file` — `/drive/v3/files` and `/drive/v3/files/{id}`.
- Google `get_meeting_transcript` — searches Drive for transcript docs.
- Google `find_meeting_slots` — `/calendar/v3/freeBusy` (POST with attendees in body).

For true per-user isolation on these, use a delegated connector (the OAuth token binds identity directly). For Google service accounts with domain-wide delegation, the connector's static `auth.subject` claim drives identity — the library does not change subjects per-call.

### Office document parsing — Meteor/webpack compatibility fix

Fixes `microsoft_read_file` / `google_read_file` / any flow that runs `OfficeHandler` from a Meteor server bundle. Symptom: every `.docx` / `.pptx` / `.xlsx` / `.odt` / `.odp` / `.ods` read failed with `[OfficeParser]: A dynamic import callback was not specified.`

- **Root cause** — officeparser 6.x triggers magic-byte format detection when given a Buffer with no extension hint. Detection uses `loadFileType()` from `dist/utils/moduleLoader.js`, which calls `new Function('s', 'return import(s)')(specifier)` to dodge bundler static analysis. V8 parses that function body in global scope where Meteor has not registered a host dynamic-import callback, so the import throws.
- **Fix** — `OfficeHandler` now writes the input Buffer to a temp file with the correct extension before calling `parseOffice(path, ...)`. officeparser then dispatches by extension at `OfficeParser.js:168` and never calls `loadFileType` — the broken `new Function(...)` path is unreachable.
- **Why not a monkey-patch** — initial fix tried to pre-import `file-type` and overwrite `moduleLoader.loadFileType`. Works in vanilla Node, but fails in Meteor consumers (e.g. icos) where rspack bundles officeparser INTO the server bundle. The bundled officeparser carries its own internal copy of `moduleLoader.js` with no link to the disk-resident one we patched.
- **Why not an extension hint** — verified: `OfficeParserConfig` has no extension/format/mimeType field. The only ways officeparser learns the format are `file.split('.').pop()` (path-string input) or `loadFileType()` (buffer input).
- **Disk dependency** — requires `os.tmpdir()` to be writable. True on every realistic Meteor host (Galaxy, MUP/Docker, k8s with default tmpfs). Cleanup runs in a `finally` block; cleanup failures log a warning and never mask a parse error.
- **Review on officeparser bumps** — run `tests/unit/capabilities/documents/OfficeHandler.test.ts` and `scripts/verify-officeparser-patch.mjs`. See the comment block at the top of `src/capabilities/documents/handlers/OfficeHandler.ts` for the full checklist.

### Storage plugins renamed to "notes" / "whiteboard" (LLM-visible only)

Disambiguates the two scratchpad stores from the graph **Memory** plugin (entities + facts). The agent now sees three distinct vocabularies instead of three things called "memory".

- **`WorkingMemoryPluginNextGen.getStoreSchema().storeId`**: `'memory'` → `'notes'`. `displayName`: `'Working Memory'` → `'Notes'`. Inline examples in `WORKING_MEMORY_INSTRUCTIONS` updated. Internal `plugin.name` (`'working_memory'`), the `WorkingMemoryPluginNextGen` class name, the `workingMemory` feature flag, the `ctx.memory` accessor, and the `StorageRegistry.workingMemory` factory key are all UNCHANGED in this release (deferred to a later coordinated rename).
- **`InContextMemoryPluginNextGen.getStoreSchema().storeId`**: `'context'` → `'whiteboard'`. `displayName`: `'Live Context'` → `'Whiteboard'`. `IN_CONTEXT_MEMORY_INSTRUCTIONS` updated. Same scope: `plugin.name`, class, feature flag, etc. UNCHANGED.
- **Cross-references in each plugin's `usageHint`** flipped accordingly (`use "context" for that` → `use "whiteboard" for that`, etc.).
- **Per-plugin section headers in the system prompt** now derive from `getStoreSchema().displayName` for IStoreHandler plugins (was always `formatPluginName(plugin.name)`). Result: the LLM sees `## Notes` / `## Whiteboard` instead of `## Working Memory` / `## In Context Memory`, matching the storeIds in the body. Non-store plugins still fall back to `formatPluginName(plugin.name)`. Snapshot `displayName` (chat-tab UI label, read by hosea/icos) is unchanged — still derived from `plugin.name`.
- **Whiteboard no longer teaches `showInUI` in its instructions or schema** — UI rendering is owned by `DynamicUIPlugin` in `@everworker/react-ui`, which already documents the flag with full markdown/dashboard semantics. The `**UI Display:**` paragraph and the `showInUI?:` line in `setDataFields` are removed from `InContextMemoryPluginNextGen`. The `showInUI` field stays on `InContextEntry` for hosts to read; the storeSet success message no longer appends `(visible in UI)`. Agents that load DynamicUIPlugin are unaffected. Agents loading only Whiteboard no longer get a misleading hint about a feature they cannot render.
- **Companion update in `@everworker/react-ui`**: `DynamicUIPlugin` instructions teach the LLM to use the new `"whiteboard"` storeId. Ship matching versions.
- **Migration impact for callers**: any LLM prompt or tool result that hardcoded `store: "memory"` or `store: "context"` must flip to `store: "notes"` / `store: "whiteboard"`. Callers using the plugin API directly (`ctx.memory!.store(...)`, `getPlugin('in_context_memory')`) are unaffected. README + USER_GUIDE examples updated; the example custom store plugin in USER_GUIDE renamed from `NotesPlugin` (storeId `'notes'`) to `SnippetsPlugin` (storeId `'snippets'`) to avoid the new collision.

### Memory: agent-rule write path tightened

Tightening pass on `memory_set_agent_rule` and the rules-block round-trip. All public types are backwards-compatible; the system-message render format changed (callers asserting on the old `[<factId>] body` literal must update).

- **Rules block render format** — `## User-specific instructions for this agent` lines now render as `- [ruleId=<id>] <body>` (was `- [<factId>] <body>`). Eliminates the LLM's mental hop between the bare bracketed id, `memory_forget.factId`, and `memory_set_agent_rule.replaces` — the bracket label now spells the field name. Preamble updated to spell out both supersede + drop paths in one sentence.
- **`memory_remember` reserves `agent_behavior_rule`** — writes with `predicate: 'agent_behavior_rule'` are now rejected at the tool layer with a structured error pointing to `memory_set_agent_rule`. Closes a back-door where an LLM ignoring the prose advisory could bypass the rule-write rate limit + ownership stamp by writing the same predicate directly. Other predicates on the agent entity still flow through (forward-compat for a future rule-inference engine that may write different predicates).
- **New `setAgentRuleRateLimit` config field** on `MemoryToolDeps`, `CreateMemoryToolsArgs`, `MemoryWritePluginConfig`. Same shape as `forgetRateLimit` (`{maxCallsPerWindow?, windowMs?}`); falls back to `forgetRateLimit`, then to the 10/60s default. Lets hosts give rule-writes a different budget than destructive `memory_forget` ops without sharing one knob.
- **`memory_forget` description cross-links rule-drop** — passing a `ruleId` from the rules block as `factId` is now documented as the canonical way to drop a behavior rule with no replacement. Use `memory_set_agent_rule.replaces` instead when *swapping* one rule for another (preserves the audit chain on the rule list).
- **Trimmed doubled prose in `WRITE_INSTRUCTIONS`** — the YES/NO trigger list and first-person rephrasing table for `memory_set_agent_rule` are now in the tool's own description only (single source of truth). Saves ~400 tokens per turn on agents carrying the write bundle. The plugin's instruction block keeps a short pointer + the "rule about YOU vs fact about the USER" asymmetry test.
- **Multi-rule guidance** — tool description now tells the LLM to call once per atomic rule when the user states several at once ("be terse, no bullets, in Russian" → three calls), so each can supersede / be forgotten independently.

### Memory plugin: 3rd-person framing, User's Active Priorities block, user timezone

`MemoryPluginNextGen.getContent()` now distinguishes 1st-person (about the agent) from 3rd-person (about the user) blocks so the agent doesn't conflate the user's context with its own.

- **3rd-person headers** — `## Your User Profile` → `## About the User (<displayName>)` and `## Your Organization Profile` → `## About the User's Organization (<orgName>)`. The "User-specific instructions for this agent" block stays in 1st person — it really does describe the agent. **Breaking** for callers asserting on the old strings; the public plugin API is unchanged.
- **`## User's Active Priorities`** — new section rendered IMMEDIATELY after the user profile block (before the organization block) when the user has at least one active tracked priority. Walks `tracks_priority` facts on the user entity, fetches the linked `priority` entities, filters by `metadata.jarvis.priority.status === 'active'`, sorts by `weight` desc with `deadline` asc as tiebreak. Each bullet renders the priority's `displayName` plus tags `(horizon, weight, deadline, scope)` when set. Section is omitted entirely when no `tracks_priority` facts exist or all referenced priorities are non-active. Write path is unchanged: `memory_upsert_entity({type:'priority', metadata:{jarvis:{priority:{...}}}})` followed by `memory_link({from:'me', predicate:'tracks_priority', to:{id:<priorityId>}})`.
- **`**Timezone:**` line** in the user profile block when `userEntity.metadata.jarvis.tz` is set (IANA string, e.g. `'Europe/Berlin'`). Lets the agent reason about "today" / scheduling without guessing UTC. User-only by convention — the renderer ignores `tz` on org/agent entities. Host apps populate it via `memory.upsertEntity({..., metadata:{jarvis:{tz:'...'}}, metadataMerge:'overwrite'})` or the LLM tool `memory_upsert_entity`.
- **Plugin instructions updated** — `MEMORY_INSTRUCTIONS` now points at the priorities section explicitly and reminds the agent that profile/priorities describe the USER (3rd person), while the rules block describes the agent (1st person, overrides default behavior).

### Routines: `routine_list` + `routine_delete` tools, summary-only listing

- **New tool `routine_list`** — slim, paginated listing of routine definitions. Filters by `tags` (ANY-of intersect), `search` (case-insensitive substring on name/description), `limit` (1–200, default 50), `offset`. Returns `{ count, hasMore, routines: RoutineSummary[] }`. The pagination probe fetches `limit + 1` to compute `hasMore` without a second round-trip.
- **New tool `routine_delete`** — permanently removes a routine definition by ID. Past execution records are preserved; downstream schedules referencing the deleted ID will fail at runtime. Marked `session`/`high` risk.
- **`routine_update` now supports `tasks` array replacement** — full add/remove/reorder/rename, dependency rewiring, control-flow changes. Re-validated via `createRoutineDefinition` (cycle + missing-dep checks) before saving. For surgical edits to a single existing task, `routine_update_task` is still preferred.
- **BREAKING — `IRoutineDefinitionStorage.list()` now returns `RoutineSummary[]`** instead of `RoutineDefinition[]`. The summary carries `id`, `name`, `description`, `version`, `author`, `tags`, `taskCount`, `parameterNames`, `updatedAt`. Use `load(id)` for the full definition. This eliminates the per-entry full-document materialization that every backend was paying — Mongo/Postgres impls can now project to summary fields server-side, and the file impl returns its index entries directly without per-entry disk reads. Custom `IRoutineDefinitionStorage` implementers must update their `list()` signature; `routine_get`'s name-search path now does an extra `load()`.
- **`RoutineSummary` exported** from `@everworker/oneringai` and `@everworker/oneringai/types`.

### Memory: task/event lifecycle primitives

Public surface for the v25 task/event reconciliation pipeline. All additions are backwards-compatible.

- **`MemorySystem.upsertEntity` now accepts `metadataMerge` + `metadataMergeKeys`.** The identifier-resolved path can now fold incoming `metadata` into an existing entity. Modes: `'fillMissing'` (only set absent keys) and `'overwrite'` (shallow-merge, incoming wins). Optional `metadataMergeKeys` whitelist pins the merge to a known set so a calendar-style sync caller cannot accidentally leak unrelated extracted fields. Default behaviour is preserved — without the option, metadata is ignored on resolve. Triggers `assertCanAccess(..., 'write')` whenever a merge actually changes a key, so read-only callers cannot push metadata. Deep-equality on values prevents spurious version bumps.
- **`MemorySystem.resolveRelatedItems(entityIds, scope, opts)`.** Multi-entity public traversal returning tasks + events that touch ANY of `entityIds` via metadata role fields or fact `contextIds`, deduped by id and tagged with `matchedEntityId`. Per-bucket `limit` (tasks and events each capped, default 50, ceiling 200). Bias note: the first input entity to surface a hit wins attribution — pass `entityIds` ordered by relevance.
- **`MemorySystem.findSimilarOpenTasks(queryText, scope, opts)`.** Semantic kNN over open tasks via `IMemoryStore.semanticSearchEntities`, post-filtered by configured active task states. `topK` clamped to `[1, 100]`, `minScore` clamped to `[0, 1]` (NaN → 0). Over-fetch floor of 30 candidates ensures small `topK` still survives the post-state filter. Returns `[]` (with `console.warn`) when the embedder or semantic adapter is missing — callers should treat semantic similarity as opportunistic, not load-bearing.
- **`diffEntityMetadata(prev, next, watchedKeys)` exported from `@everworker/oneringai`.** Pure helper for callers detecting external metadata changes (e.g. a calendar API event update) so they can emit predicate facts (`cancelled`, `rescheduled`) without re-implementing diff logic per call site. Reports `added` / `removed` / `changed`, deep-compares arrays/objects/Dates.
- **Three new lifecycle predicates** (now 54 total in `STANDARD_PREDICATES`):
  - `prepares_for` (task → event, inverse `prepared_by`) — completing the task readies the user for the event; lets cancellation propagate onto bound prep tasks.
  - `delegated_to` (task → person, inverse `delegate_of`) — captures the act of handoff distinctly from the resulting `assigned_task`.
  - `cancelled_due_to` (task | event → entity, inverse `cancellation_cause_for`) — cancellation provenance.

## [0.6.0] - 2026-04-25

> **Headline: the Memory System.** This release lands a brain-like, self-learning knowledge layer for agents — entity + fact graph, signal ingestion, semantic entity resolution, per-user/per-agent behavior rules, restraint-posture extraction, and a write/read-split plugin pair that turns ambient conversation into durable, scoped memory. Most of the entries below are pieces of that single arc; the rest is plumbing (model-registry refresh, no-silent-truncation policy, Sora extend/remix/edit) and a sweep of test fixes that brought the integration suite back to green.
>
> **Memory at a glance:**
> - **Two-plugin split:** `MemoryPluginNextGen` (read-only, 5 `memory_*` tools, injects user profile + per-agent rules into the system message) + `MemoryWritePluginNextGen` (6 `memory_*` write tools, optional sidecar). Either can run alone.
> - **Self-learning via background extraction:** `SessionIngestorPluginNextGen` watches the conversation, batches turns, dedups against in-flight `memory_*` tool calls, and writes facts in the background — no inline prompt overhead.
> - **Per-user-per-agent behavior rules:** `memory_set_agent_rule` lets the agent capture user-specific style/tone/format directives and re-renders them at the top of the system message every turn. Owned by the user, scoped to the agent, supersedeable.
> - **Restraint posture (v5 prompt):** eagerness profiles, anchor registry, anchor-bound priorities, optional skeptic pass — plus prompt-injection hardening on every attacker-controllable surface.
> - **Semantic entity resolution (opt-in):** `enableSemanticResolution` plus `ensureVectorSearchIndexes()` for Atlas Vector Search; cap-protected so flipping the flag alone never auto-merges.
> - **Three-principal permissions:** owner / group / world with read/write levels, enforced at storage for reads and at the system facade for writes.
> - **First-class storage:** in-memory adapter ships, `MongoMemoryAdapter` (raw + Meteor-reactive) for production with `$graphLookup` and `$vectorSearch` fast paths.
> - **Subconscious by default:** the agent never narrates memory operations to the user — memory is private notebook, not chat.
>
> See the new `docs/MEMORY_*.md` set and `USER_GUIDE.md` §15 for the full guide.

### Test-suite fix-up — store_* unification, registry-driven model selection

Brought the integration suite back to green after the v0.5.x tool-name unification and a wave of model-registry churn. Source code untouched — tests only.

- **Unified `store_*` tools** — rewrote ~50 tests across `userInfo.test.ts`, `ContextNextGenPlugins.mock.test.ts`, `ContextNextGenIntegration.mock.test.ts`, `ContextNextGenWithAgent.integration.test.ts`, `ProviderConverters.integration.test.ts`, and `routineControlFlowExecution.test.ts` to use the v0.5.0 unified `store_set` / `store_get` / `store_delete` / `store_list` / `store_action` API in place of the old plugin-specific tool names (`memory_store`, `context_set`, `instructions_set`, `user_info_set`, …). Includes the 24 mocked LLM tool calls in the routine control-flow tests.
- **Capability-aware AllModels test** — `tests/integration/text/AllModels.integration.test.ts` now derives skip/parameter decisions from registry features rather than hardcoded names. Realtime, audio, deep-research, open-weight, and live-preview models are filtered out automatically; `gpt-5.x-chat-latest` aliases are treated like reasoning models (no `temperature`).
- **Anthropic deprecated-model swap** — replaced hardcoded `claude-3-5-haiku-20241022` references with `claude-haiku-4-5-20251001` in 4 test files.
- **Strategy registry rename** — `'proactive'` / `'lazy'` strategy names → `'algorithmic'` in `ContextNextGenIntegration.mock.test.ts` (the proactive/lazy strategies were retired earlier).
- **Removed dead test** — `tests/integration/search/WebSearch.integration.test.ts` imported a removed module (`webSearch.js` was replaced by the `createWebSearchTool` factory pattern).
- **MCP namespace assertion fix** — `MCPStdio.integration.test.ts` was checking for `mcp:filesystem:` prefix on namespaced tool names, but `sanitizeToolName` collapses colons to underscores; fixed to `mcp_filesystem_`.
- **Multi-turn alice prompt + DALL-E 2 variations skip** — strengthened the gpt-4o-mini multi-turn prompt to be deterministic; `describe.skip` on DALL-E 2 image variations (legacy endpoint, OpenAI returns 404).

### Memory v5: restraint posture review fixes

Follow-up audit of the restraint-posture work surfaced seven issues; all fixed in this batch.

- **`evidenceQuote` now reaches storage.** The field was added to `IFact`, advertised by the v5 prompt, and accepted by `ExtractionResolver` — but `MemorySystem.addFact` constructed its `NewFact` literal without it, silently dropping the quote at the storage boundary. The same omission existed on the `state_changed` audit-fact path through `transitionTaskState`. Both now propagate. Added `MemorySystem.addFact` and `ExtractionResolver` round-trip tests pinning the behaviour.
- **v5 primitives re-exported from the package root.** `EAGERNESS_PRESETS`, `buildEagernessProfile`, `getEagernessPreset`, `resolveEagerness`, `StaticAnchorRegistry`, `emitRestraintEvent`, `applyRestrainedExtractionContract`, `SkepticPass`, `defaultSkepticPrompt`, `parseSkepticOutput` (plus the matching types) are now available from `@everworker/oneringai`. Previously only reachable via the `./memory` subpath, which `package.json` does not export.
- **`emitRestraintEvent` no longer silently swallows listener errors.** A throwing listener was caught and discarded, blackholing every decision invisibly — directly contradicting the project's "no silent error" rule. The catch now logs via `console.error` with the event attached; the throw still does not propagate (a logging failure must not break the data path). Test updated to assert both behaviours.
- **Prompt-injection hardening on new v5 surfaces.** `defaultExtractionPrompt` now sanitises anchor labels and negative-example snippets (collapse newlines, strip backticks, drop leading `#`) before splicing into the system prompt — same posture as the v4 nonce-wrapped signal body. Same hardening applied to `SkepticPass.defaultSkepticPrompt` for `item.summary` and `contextHint`. Both attacker-controllable today via extracted email content / scraped pages.
- **`SkepticPass` matches the `IDisposable` pattern.** Added `isDestroyed` getter and made `destroy()` idempotent. Calling `destroy()` twice no longer double-destroys the underlying agent.
- **Chatty preset no longer renders the Restraint preamble for nothing.** When every flag in the profile is off (e.g. `EAGERNESS_PRESETS.chatty`), `defaultExtractionPrompt` now skips the entire `## Restraint posture` section — saves tokens on every chatty call.
- **Soft-mode anchor binding distinguishes "stale" from "no binding".** `RestrainedExtractionContract` previously emitted `priority_unbound_soft` for both unbound tasks and tasks pointing at decommissioned anchors. The stale case now emits `priority_stale_soft` with `meta.servesAnchorIdProvided` set, so dashboards can tell "LLM didn't bind" from "LLM bound to inactive priority".

### Self-Learning Memory documentation overhaul

Rewrote the Self-Learning Memory section in `USER_GUIDE.md` (now a dedicated, comprehensive walkthrough at TOC #15) and updated the matching section in `README.md` (10b). Brings the user-facing docs in sync with the current code surface:

- Tool count corrected to **11** (5 read + 6 write) — both docs previously claimed 8/10. `memory_set_agent_rule` is now listed in the write-tool table.
- Wiring example updated to the actual API: `context: { features, plugins }` (the prior `contextFeatures` / `pluginConfigs` field names did not exist).
- Injected-context block updated to reflect the current renderer: rules block (`## User-specific instructions for this agent`) → user profile → optional organization profile when `groupBootstrap` is set. Removed the stale "Agent Profile" section that no longer auto-renders.
- Added coverage for `groupBootstrap`, `recentActivity` profile-injection field, `defaultVisibility` semantics, `MemoryWritePluginNextGen` config, and the `forgetRateLimit` knob.
- New subsections for storage backends (`InMemoryAdapter`, `MongoMemoryAdapter` raw + Meteor), permissions and scope (three-principal model), security invariants (no ghost-writes, `contextIds` auto-downgrade, numeric clamping), behavior rules via `memory_set_agent_rule`, background ingestion via `SessionIngestorPluginNextGen`, and direct `MemorySystem` access for server-side code.
- Cross-links to `docs/MEMORY_GUIDE.md`, `docs/MEMORY_API.md`, `docs/MEMORY_PERMISSIONS.md`, `docs/MEMORY_SIGNALS.md`, `docs/MEMORY_PREDICATES.md`.
- README "Available Features" table now includes rows for `memory` and `memoryWrite` flags.

No source changes — documentation only.

### Added GPT-5.5 (new OpenAI flagship)

Registered `gpt-5.5` as the new OpenAI flagship and moved the `preferred` flag from `gpt-5.4` to `gpt-5.5`. 1,050,000-token context, 128,000-token max output, knowledge cutoff 2025-12-01. Reasoning.effort: none / low / medium (default) / high / xhigh. Pricing $5 input · $0.50 cached · $30 output per 1M tokens; prompts >272K input tokens are billed at 2× input / 1.5× output for the full session. Vision in, text out, prompt caching + batch + Responses API supported.

### Added GPT-5.4 mini and GPT-5.4 nano

Registered `gpt-5.4-mini` and `gpt-5.4-nano` (release 2026-03-17, knowledge cutoff 2025-08-31). 400K context / 128K max output. Vision-in, text-out. Reasoning.effort: none / low / medium / high / xhigh. Per 1M tokens: mini $0.75 input · $0.075 cached · $4.50 output; nano $0.20 · $0.02 · $1.25.

### Sora: dedicated extend / remix / edit + Character API

Aligned the OpenAI Sora provider with the SDK's split between three transforms on completed videos:

- **`videoGen.extend({ video: jobId, prompt, extendDuration })`** now calls the real `videos.extend()` endpoint (added in openai-node 6.28). Previously this method aliased onto `videos.remix()`, which kept the clip the same length — the new behaviour generates an actual additional segment whose length is controlled by `extendDuration` (snapped to the SDK-allowed `4 / 8 / 12` seconds). **Behaviour change for existing callers**: if you relied on the old alias, switch to `videoGen.remix(...)` (below).
- **`videoGen.remix({ videoId, prompt })`** — same length, prompt-steered re-generation.
- **`videoGen.edit({ videoId, prompt })`** — apply a prompt-described change to a completed clip.
- **`videoGen.createCharacter({ name, video })` / `videoGen.getCharacter(id)`** — register a reusable character from a reference video and thread its id back into a future `generate()` via `vendorOptions.characterId` for cross-shot continuity. Accepts `Buffer`, local path, or HTTP URL.

All four are optional methods on `IVideoProvider` — non-OpenAI providers throw a clear "not supported" error rather than silently no-op. New types exported: `VideoRemixOptions`, `VideoEditOptions`, `CreateCharacterOptions`, `CharacterRef`.

Higher-resolution Sora exports (`1024x1792`, `1792x1024` — 1.4× the standard 720p) were already wired through the `resolution` / `aspectRatio` mappers; the supported set is now documented in the Video Generation section of the user guide.

### Performance: skip redundant Buffer copy on media uploads

Eliminated a double-allocation on the path that turns a `Buffer` (or `ArrayBuffer`) into a `File` for upload to OpenAI / Grok. The previous shape `new File([new Uint8Array(buffer)], …)` triggered the typed-array overload of `Uint8Array`, copying every byte into a fresh `ArrayBuffer` *before* the `File` snapshotted them — so each upload was double-allocating its payload before the bytes left the process. The fix is to pass the `Buffer` / `ArrayBuffer` directly to `new File([buffer], …)` (cast to `BlobPart` to satisfy the modern Node `Buffer<ArrayBufferLike>` typing). For a 500 MB Sora upload, this drops peak memory from ~1.5 GB to ~1 GB during the upload window.

Touched (8 sites in 4 files): `OpenAISoraProvider.prepareImageInput` + `prepareVideoInput`, `OpenAISTTProvider.prepareAudioFile`, `OpenAIImageProvider.prepareImageInput`, `GrokImageProvider.prepareImageInput`. Added a byte-fidelity regression test (`OpenAISoraProvider.test.ts`) that round-trips a known Buffer through `createCharacter` and asserts the resulting `File.size` and bytes match the source.

`PDFHandler.handle` deliberately keeps its `new Uint8Array(buffer)` calls — `unpdf` (pdf.js) detaches the underlying `ArrayBuffer` when posting to its worker, so each call genuinely needs a fresh copy. Added a live round-trip test (`tests/unit/capabilities/documents/PDFHandler.test.ts`) that builds a minimal valid PDF in memory, runs it through `PDFHandler` twice with the *same* source `Buffer`, and asserts text extraction succeeds both times — pinning the existing behaviour so any future "cleanup" PR that drops the explicit copy gets caught.

### TTS: custom voices (OpenAI)

`TextToSpeech` now accepts custom-voice ids alongside built-in voice names. Any string starting with `voice_` (the prefix OpenAI returns when a custom voice is created in the dashboard) is forwarded to the SDK as `{ id }`; built-in names (`alloy`, `nova`, `cedar`, etc.) pass through unchanged. No interface changes — `TTSOptions.voice` stays `string`.

```typescript
const tts = TextToSpeech.create({
  connector: 'openai',
  model: 'gpt-4o-mini-tts',
  voice: 'voice_1234abcd',
});
```

### No silent truncation of LLM content (output + input)

Library-wide policy change: we no longer silently clip content that flows to an LLM, is generated by an LLM, or is persisted from an LLM response. Old defaults quietly dropped content that modern model context windows could easily handle; hosts lost information they didn't know they'd lost. The new stance:

- **Output-side — no hardcoded `maxOutputTokens` defaults.** If the caller doesn't set one, nothing is passed on the wire — the model's own ceiling applies (always the maximum it can physically emit).
- **Input-side — pass content through verbatim.** When a host-controlled budget exists (transcript chars, tool output ceilings), the default is set high enough that normal traffic never hits it. When the model's hard context window is the only constraint left, we warn and proceed rather than fail.
- **Spill, don't drop.** Where we previously discarded content at a boundary (compacted tool pairs, oversized tool results), the path now prefers writing to working memory and returning a reference.

Removed hardcoded output-token defaults:

- `ConnectorProfileGenerator.maxOutputTokens` — was `?? 1200`, now undefined pass-through.
- `ConnectorExtractor.maxOutputTokens` — was `?? 2000`, now undefined pass-through (both `new` + `withAgent`).
- `SessionIngestorPluginNextGen.maxOutputTokens` — was `?? 2000`, now undefined pass-through. Also removed the `Math.min(..., 800)` floor on the details-merge call that silently clipped merged narratives tighter than the main call.
- `routineControlFlow.llmExtractArray` — removed literal `maxOutputTokens: 4096` AND the 8 K char input truncation.
- `SummarizeCompactor` — removed `max_output_tokens: maxSummaryTokens + 100`; the prompt already carries a target length.
- `AnthropicConverter` — `max_tokens: options.max_output_tokens || 4096` → now uses the model's capability max from the registry (e.g. 64K on Claude 4.6) when unset, with a final fallback to 64_000 for unknown models. Anthropic's API requires the field, so we still send one, but it's no longer a 4K artificial ceiling.

Removed input/persisted-content truncation:

- `ConnectorProfileGenerator.parseProfileResponse` — removed the 8 KB / 1.2 KB per-field clips AND the 80-word summary-derivation slice. Full generator output now lands in the profile fact.
- `MemorySystem.regenerateProfile` — removed `takeWithinTokenBudget` + `profileRegenerationTokenBudget`. The existing 500-fact query cap (by recency) stays; everything up to that cap is passed to the generator.
- `memory/integration/defaultPrompt.ts` — removed `newFacts.slice(0, 100)` AND the per-fact `truncate(details, 160)` / `value.slice(0, 80)` clips in the profile-regen prompt.
- `SessionIngestorPluginNextGen` — removed `TOOL_CALL_ARGS_MAX_CHARS=500` and `TOOL_RESULT_MAX_CHARS=240`. The outer `maxTranscriptChars` budget is now the single source of truth; its default bumped **20_000 → 1_000_000 chars** (~250K tokens, fits every cheap extractor model with headroom).
- `MemoryPluginNextGen` — removed `MAX_RULE_CHARS=300` (user-authored behavior rules rendered in full) and removed the default `maxFactLineChars=200` (now undefined = no cap; callers can set explicitly).
- `SharedWorkspacePluginNextGen` — removed 500-char workspace content preview cap; full entry content is rendered.
- `AlgorithmicCompactionStrategy` — removed the 150-char description cap and the 30-char per-arg-value cap in `summarizeArgs`. Also reworked the "exceeds maxToolPairs" eviction path: when working memory is available, aged pairs are **spilled to WM** (not deleted) so the agent can still retrieve them via memory lookup.
- `htmlToMarkdown` — `maxLength` is now optional (undefined = no cap). `DOCUMENT_DEFAULTS.MAX_HTML_LENGTH` bumped **50_000 → 10_000_000** chars.
- `tools/shell/bash.ts` — default `maxOutputSize` bumped **100_000 → 10_000_000** chars. Removed the head-clip-at-close (was contradicting the streaming tail-preservation rolling buffer).
- `tools/filesystem/readFile.ts` + `tools/github/readFile.ts` — removed the per-line 2000-char clip; full lines now returned.
- `tools/filesystem/grep.ts` — removed the 500-char match-line cap and 200-char context-line caps.
- `tools/google/listMeetings.ts` + `searchFiles.ts` — removed 200-char description/snippet clips.
- `core/orchestrator/createOrchestrator.ts` — removed five separate 500/300/200/100-char clips on agent descriptions, delegation workspace entries, and post-turn monitor prompts.
- `core/context-nextgen/AgentContextNextGen.ts` — emergency tool-result truncation (fires only when a tool output alone exceeds the model window) now emits a `logger.warn` with before/after token counts in addition to the existing `warning` field on the returned `OversizedInputResult`.

Policy is captured in two durable rules:
- `feedback_no_truncation.md` — never clip content going to LLMs, batch/split instead.
- `feedback_no_output_limits.md` — never hardcode `maxOutputTokens`; pass undefined if the caller didn't set one.

Post-sweep regression fixes + observability (one bug, four warn logs):

- **`bash.ts` rolling-buffer truncation was silent** — regression from the sweep. When bash stdout/stderr grows past `maxOutputSize * 2` (20 MB default), the streaming rolling-buffer slices the head to preserve the tail. The earlier change in this release set `const truncated = false` unconditionally at close, so the returned `BashResult.truncated` was always `false` even after the rolling buffer fired. Fixed: a closure-scoped `rollingBufferTruncated` flag now tracks buffer activation; `BashResult.truncated` reflects it; a `logger.warn` fires with stdout/stderr byte counts. Includes a new unit test asserting `truncated: true` + tail preservation.
- **Operator warn logs for oversized tool outputs** — `bash`, `web_fetch`, `read_file`, and `github_read_file` now emit a `logger.warn` with byte counts when their result exceeds 1 MB. No truncation — just observability so operators see large payloads flowing into the next LLM turn rather than discovering them via latency/cost.
- **`MemorySystem.regenerateProfile` prompt-size warn** — when the estimated prompt input (prior profile + new-fact details/values/summaries) crosses 200 KB, a `console.warn` fires with the entity id, estimated chars, and new-fact count. No cap; purely observability per the no-truncation policy.
- **`AnthropicConverter` fallback warn** — when neither the caller's `max_output_tokens` nor `getModelInfo(model)?.features?.output?.tokens` supplies a value, the converter falls through to a 64 K default for Anthropic's mandatory `max_tokens` field. That fallthrough now logs a warn so operators notice unregistered / misregistered models before the Anthropic API rejects a mismatch.
- **Doc fix:** `HTMLFormatOptions.maxLength` JSDoc updated from the stale "default: 50000" to reflect the new 10 M default.

Breaking? Mostly no — defaults are raised, not lowered, and callers that already passed explicit values are unaffected. Two nominal breaks: (1) `ConnectorProfileGenerator.maxOutputTokens` / `ConnectorExtractor.maxOutputTokens` / `SessionIngestorPluginNextGen.maxOutputTokens` default changed from a finite number to undefined — hosts that were relying on the old implicit cap now get full model output. (2) Tests that asserted specific truncation behavior have been updated to assert the new pass-through behavior.

### Memory subsystem hardening — security + correctness

Round of small, surgical fixes to the memory layer surfaced by an internal code review. No breaking changes for default config paths; one behavioral tightening on `CalendarSignalAdapter` (opt-out available).

- **Prompt-injection defense on signal extraction (`defaultExtractionPrompt` v4):** signal content is now wrapped with nonce-randomized `<signal_content_XXXXXXXX>` delimiters so an attacker-controlled email body containing a plain `</signal_content>` can't close the tag and override the extraction instructions. Same pattern already used by `SessionIngestorPluginNextGen`. `DEFAULT_EXTRACTION_PROMPT_VERSION` bumped 3 → 4.
- **`task.metadata.stateHistory` capped:** `MemorySystem.transitionTaskState` previously appended to `stateHistory` without bound, so a task cycled through states thousands of times could push the entity document past Mongo's 16 MB limit. New `MemorySystemConfig.stateHistoryCap` (default 200) retains the most-recent N entries; full audit history is still recoverable from the `state_changed` facts themselves (which remain unlimited — Category-D "defensible" truncation, per the no-truncation policy: the full data lives elsewhere, this cap only bounds a denormalized duplicate).
- **`memory_forget` foreign-context visibility downgrade fixed:** when the LLM called `memory_forget` without explicitly setting `visibility` (the common case — the schema doesn't expose it), the foreign-context downgrade check was being skipped, and the new fact silently inherited the predecessor's (potentially group- or public-readable) permissions. Aligned the check with `remember.ts` / `link.ts`, which fire on any non-`'private'` visibility (including undefined).
- **`CalendarSignalAdapter.skipDeclinedAttendance` now drops declined attendees completely** (default true): no person seed, no `attended` seedFact, and they no longer appear in `signalText`. The previous behavior (seed person + list in signalText, skip only the seedFact) let the LLM infer attendance from name presence alone, defeating the flag's intent. Set `skipDeclinedAttendance: false` to keep the old behavior.
- **`MemoryPluginNextGen` bootstrap duplicate detection:** after the user/agent entity upserts, the plugin now calls `MemorySystem.findEntitiesByIdentifier` on the same identifier; >1 result triggers a structured `logger.error` (not a throw — bootstrap still succeeds) with the duplicate ids and a pointer to H8 / CLAUDE.md. Surfaces the silent misconfiguration where the cross-process unique index on `(identifiers.kind, identifiers.value)` is missing or not enforcing. Self-check failures are caught and logged as `warn` so an adapter hiccup never breaks bootstrap.
- **Docs (`CLAUDE.md`):** Atlas Vector Search index creation section re-flagged — programmatic `ensureVectorSearchIndexes()` is now the supported path; the manual-UI option is documented as a security footgun (silent scope filter bypass when filter paths aren't declared) and strongly discouraged.

New public surface:
- `MemorySystem.findEntitiesByIdentifier(kind, value, scope)` — pass-through to `IMemoryStore` (used by the plugin's duplicate self-check; safe for any caller to use).

Config additions:
- `MemorySystemConfig.stateHistoryCap` (default 200)

### Entity-level semantic resolution (opt-in) + `ensureVectorSearchIndexes` helper

The memory layer has been writing an `identityEmbedding` on every entity since v0.4 but no code read it — `EntityResolver` was exact-only, so typos like "Microsft" → "Microsoft" created duplicates. This change adds the semantic tier that consumes those embeddings and ships the Mongo plumbing to make it production-ready.

**Shape of the change:**
- **New capability on `IMemoryStore`:** `semanticSearchEntities(queryVector, {type?, types?}, {topK, minScore?}, scope)` — cosine over `identityEmbedding`, archived excluded, scope enforced. Optional (duck-typed) — stores without it skip the semantic tier gracefully. Both in-tree adapters implement it.
- **New config flag:** `EntityResolutionConfig.enableSemanticResolution` (default `false`). Opt-in because any confidence-calibration miss could silently merge different entities; existing deployments keep exact-only behavior until they flip the flag.
- **EntityResolver Tier 4 — semantic match:** runs after tiers 1-3 when the flag is on, an embedder is wired, and the store implements `semanticSearchEntities`. Skipped when tier 1 produced a 1.0 identifier match (saves an embed). Cosine floor 0.75; confidence capped at 0.89 — strictly below the default auto-resolve threshold (0.90) so enabling the flag alone NEVER auto-merges. The LLM sees semantic candidates as merge candidates; callers who trust the scoring lower `autoResolveThreshold` (e.g. to 0.75) to opt into auto-merge.
- **No new LLM tool.** Retrieval tools (`memory_recall`, `memory_graph`, `memory_find_entity`, `memory_search`) already delegate entity resolution to `EntityResolver.resolve()`, so typo-tolerant lookup comes for free without expanding the tool surface or changing tool descriptions.
- **Both Mongo wrappers supported:** new `createSearchIndex` / `listSearchIndexes` hooks on `IMongoCollectionLike`. `RawMongoCollection` calls the driver directly; `MeteorMongoCollection` routes through `rawCollection()` (same pattern as existing `aggregate`). Neither wrapper is a runtime dependency of the adapter — the methods are structurally optional.
- **`MongoMemoryAdapter.ensureVectorSearchIndexes({dimensions, similarity?, factsIndexName?, entitiesIndexName?, waitUntilReady?})`:** opt-in, programmatic creation of Atlas `$vectorSearch` indexes for both the facts collection (`embedding`) and the entities collection (`identityEmbedding`). Idempotent — existing indexes by name are detected via `listSearchIndexes` and skipped. When `waitUntilReady:true` (default) polls until `queryable: true` or timeout. Requires mongodb node driver v6.6+ and Atlas Server v6.0.11+. Clients can also create indexes manually via Atlas UI; the adapter's `vectorIndexName` / `entityVectorIndexName` options must match the chosen names.
- **New adapter option:** `MongoMemoryAdapterOptions.entityVectorIndexName` — when set + `entities.aggregate` present, `semanticSearchEntities` dispatches through `$vectorSearch` instead of cursor-scan cosine.

**Security — `$vectorSearch` filter enforcement (applies to BOTH the new entities path and the pre-existing facts path):**
- Atlas `$vectorSearch` silently ignores `filter` clauses whose paths aren't declared as `type:'filter'` in the index definition. Our runtime queries pass `scope` (groupId / ownerId / permissions), `archived`, and type/predicate/subject/object narrows into the filter — so if the index is missing those declarations, Atlas returns entities / facts across all scopes (cross-group, cross-permission leakage).
- `ensureVectorSearchIndexes` now declares scope + archived + discriminator paths automatically. See `ENTITIES_FILTER_PATHS` / `FACTS_FILTER_PATHS` in `MongoMemoryAdapter.ts` for the exact lists.
- **Action for existing deployments** that created vector indexes manually via Atlas UI: drop and recreate with the filter fields from the constants above, OR switch to `ensureVectorSearchIndexes` which does it for you. Without this, the `$vectorSearch` fast path is scope-bypassing.

**Other hardening:**
- `dimensions` param validated as positive integer at entry.
- Concurrent `ensureVectorSearchIndexes` from multiple containers absorbed: if another process wins the race, the duplicate-create error is swallowed (idempotent).
- Index names default to the adapter's own `vectorIndexName` / `entityVectorIndexName` so helper-created indexes always match runtime-query names — no silent "index created but queries use cursor scan" footgun.
- Fire-and-forget semantics — helper returns as soon as Atlas accepts the create request; the 30–60s async index build runs during startup migrations, so the index is ready before real traffic arrives.
- EntityResolver semantic-tier error path uses the structured `logger` (not `console.warn`), and skips the embed+search entirely when the surface normalizes to empty (pure-punctuation / whitespace).

**What's preserved:**
- **Zero behavior change by default.** `enableSemanticResolution` defaults false; exact-only resolution is identical to prior versions.
- **Tier ordering preserved.** Semantic tier never downgrades a higher-tier match on the same entity (tier 1-3 confidence always wins on ties).
- **Scope + archived invariants preserved.** Both adapter implementations apply `ScopeFilter` and hide archived entities. Tested end-to-end.

**Tests added (23 new):**
- `tests/unit/memory/InMemoryAdapter.test.ts` (9) — cosine ranking, topK truncation, dimension-mismatch skip, missing-embedding skip, single + union type filters, archived exclusion, scope visibility (cross-group private hidden), `minScore` floor.
- `tests/unit/memory/resolution/EntityResolver.test.ts` (10) — opt-out default (typos still miss even with embedder), opt-in resolves typos, confidence cap prevents auto-merge, lowered `autoResolveThreshold` allows semantic merge, tier-1 identifier short-circuit (no embed call), no downgrade of higher-tier match, type filter honored, below-cosine-floor → no candidate, embedder-failure log + graceful tier-1-3 fallthrough, context-aware disambiguation boost on semantic candidates.
- `tests/unit/memory/adapters/mongo/MongoMemoryAdapter.test.ts` (14) — cursor-scan ranking, skip unembedded + mismatched dim, archived excluded, type filter (single + union), scope visibility, `minScore` floor, `find()` dispatch when no vector index, `aggregate()` dispatch with `entityVectorIndexName`, `ensureVectorSearchIndexes` creates correct definition for both collections, idempotent on re-run, custom index names, `factsIndexName: null` skip, non-default similarity, polling until READY, error on FAILED status, actionable timeout error.
- `tests/integration/memory/MongoMemoryAdapter.integration.test.ts` (2) — end-to-end cosine ranking + archived/type/minScore on real Mongo (gated on `mongodb-memory-server`).
- Existing "typos do NOT fuzzy-resolve in v1" assertion updated to reflect current state ("semantic is opt-in; default still exact-only") without weakening the guarantee.

**Migration guidance for client apps:**
```ts
// 1. Turn on the feature flag:
new MemorySystem({
  store,
  embedder,
  entityResolution: { enableSemanticResolution: true },
});

// 2. On Mongo deployments, create the Atlas Vector Search index(es) from your migration:
await (adapter as MongoMemoryAdapter).ensureVectorSearchIndexes({
  dimensions: embedder.dimensions,   // MUST match embedder
  similarity: 'cosine',              // default
});
// Adapter options must name the same indexes:
new MongoMemoryAdapter({
  entities, facts,
  vectorIndexName: 'facts_vector',
  entityVectorIndexName: 'entities_vector',  // enables $vectorSearch fast path
});
```

### User-specific agent behavior rules — `memory_set_agent_rule` + rules block

New narrow-trigger channel for **per-user, per-agent behavior directives**. Addresses the long-running tension between "agent self-learns from ambient observation" (which produced noise and meta-procedures) and "agent never modifies its own behavior" (which stranded user corrections like "stop apologizing" with nowhere to go).

**Shape of the change:**
- Different users may give DIFFERENT instructions to the same agent — user A says "be terse", user B says "be verbose". Rules are therefore scoped per-user, not global. Global agent personality / base instructions are admin-controlled via `Agent.create({ instructions })` — never synthesized.
- Distinction is a **data-model shape**, not a predicate whitelist: rules are facts with `subjectId = agentEntityId`, `ownerId = userId`. A future rule-inference engine can add facts with any predicate under the same shape and they surface automatically.

**New tool: `memory_set_agent_rule`.** Added as the 6th tool in the write bundle (`createMemoryWriteTools` / `MemoryWritePluginNextGen`). Signature: `{ rule: string, replaces?: string }`. Auto-fills subject = agent entity, predicate = `agent_behavior_rule`, visibility = `private`, importance = 0.95. Narrow trigger: the WRITE_INSTRUCTIONS spell out YES/NO cases — YES for tone / style / format / language / meta-interaction rules; NO for task requests, calendar actions, factual corrections, or user statements (those have their own paths). Supersession via `replaces = <ruleId>`; deletion via `memory_forget`.

**New system-message block: `## User-specific instructions for this agent`.** Rendered by `MemoryPluginNextGen.getContent()` above the user profile block. Queries `findFacts({ subjectId: agentEntityId, archived: false }, ..., { userId })` — ownerId match via scope filter. Each rule shows as `- [<shortId>] <rule text>  \`ruleId=<fullId>\`` so the agent can reference it when superseding. Long rules truncated at 300 chars with ellipsis; archived rules excluded. Block is omitted entirely when the user has no rules.

**Removed: `## Agent Profile` auto-render.** Global agent profile was synthesized from ambient facts and injected into every turn, but in practice the "thorough-diligence agent learnings" path produced more noise than signal. Admin instructions are the right tool for agent personality. The agent entity itself still exists — it's the subject of user directives, used as `"this_agent"` in tool arguments, and available for graph queries — just not auto-summarized into the system message.

**Other changes:**
- `SessionIngestorPluginNextGen` extraction prompt: **dropped agent-learnings section entirely**. All three diligence levels (minimal / normal / thorough) now explicitly forbid `subject: m_agent` writes. Agent behavior is owned exclusively by `memory_set_agent_rule` (user-driven) and admin instructions (global). Removes the `renderAgentLearningsSection` helper.
- `MemorySystem.maybeRegenerateProfile`: **guard added** — skips regen when the subject entity's `type === 'agent'`. Cheap `getEntity` lookup; avoids wasted LLM calls for profiles nobody reads. User-subject regen is unchanged.
- `MemoryPluginNextGen.MemoryPluginConfig.agentProfileInjection` is **kept in the type for backward-compat but is no longer read**. Passing it is a no-op; callers can remove it safely.

**Tests added (12 new):**
- `tests/unit/tools/memory/setAgentRule.test.ts` (5) — happy path, missing bootstrap → structured error, empty-rule rejection, supersession via `replaces` (predecessor archived + new `supersedes` set), schema validity.
- `tests/unit/core/context-nextgen/plugins/MemoryPluginNextGen.rulesBlock.test.ts` (7) — no block when no rules, renders each rule with short+full id, no old `## Agent Profile` block, archived rules excluded, truncation of long rules, rules render BEFORE the user profile (directive priority), profile regen guard for agent-type entities.

**Updated existing tests:**
- `factorySplit.test.ts` — write bundle is now 6 tools, combined is 11.
- `AgentContextNextGen.memoryFeatureFlag.test.ts` — write-plugin length is 6; total across plugins is 11.
- `MemoryWritePluginNextGen.test.ts` — tool bundle length + destroy lifecycle assertions updated.
- `MemoryPluginNextGen.test.ts` — bootstrap + injection tests no longer assert `## Agent Profile`; now explicitly assert its absence.
- `SessionIngestorPluginNextGen.test.ts` — old "agent-learnings section" tests replaced with a single parametric test asserting `DO NOT extract facts with subject m_agent` appears at every diligence level and the legacy section never reappears.

All 4951 tests pass.

### Review-pass follow-ups (same unreleased set)

Tightening after a thorough review of the rules-block + `memory_set_agent_rule` change.

**Security — ghost-write guard on `memory_set_agent_rule`.** Uncovered during review: `MemorySystem.addFact` derives `fact.ownerId` from the *subject entity's* owner (via `deriveFactScope`), not the caller's scope. For the agent entity that means a cross-owner write silently lands with the agent-owner's id attached — effectively injecting a rule into *their* system-message rules block. The tool now pre-checks `agent.ownerId === scope.userId` and returns a structured error with a multi-user hint when they diverge (matches the pattern `memory_remember` already uses). No change to the memory-layer invariant itself; the check is at the tool boundary where the caller's intent is trusted.

**Rate limit on `memory_set_agent_rule`.** Defaults to 10 writes per 60 s per user (same policy as `memory_forget`, shared `deps.forgetRateLimit` override). Rules are rendered into every subsequent system message until superseded, so the cost of a jailbreak-spam is asymmetric; cheap insurance to cap it.

**Render filter hardening.** The rules-block filter in `MemoryPluginNextGen.renderRulesBlock` now rejects facts with `ownerId !== scope.userId` strictly (previously let `ownerId === undefined` through as a defensive no-op — in theory fine because the library enforces `OwnerRequiredError`, but tighter is better against legacy data migrations).

**Render shape simplified.** Dropped the redundant `[shortId] … \`ruleId=<fullId>\`` double-render. Now just `[<fullId>] <rule>` — the full id is what the agent passes to `replaces`, the short form saved nothing useful. ~30 tokens per rule.

**Dead-code cleanup.** Removed the `void AGENT_BEHAVIOR_RULE_PREDICATE;` expression + the constant's import from `MemoryPluginNextGen.ts` (it had no runtime effect; the comment overstated what `void` does for tree-shaking).

**Main-package exports.** Added `createSetAgentRuleTool` and `AGENT_BEHAVIOR_RULE_PREDICATE` to `src/index.ts` (next to the other memory tool creators) for consistency with the existing `createRememberTool` / `createForgetTool` / … surface.

**Docs synced.** Fixed stale tool counts across `CLAUDE.md` (5→6 write, 10→11 total), `docs/MEMORY_GUIDE.md` (same counts + replaced the `## Agent Profile` example output with the new rules block + user profile), and `src/core/context-nextgen/types.ts` JSDoc on the `memoryWrite` feature flag. Added a dedicated `#### memory_set_agent_rule` subsection to `MEMORY_GUIDE.md` covering narrow-trigger rules, supersession, render shape, and rule-engine compatibility.

**Test coverage additions (3 new):**
- Ownership mismatch → structured error (caller ≠ agent-entity owner).
- Rate limit honors `deps.forgetRateLimit` — 3rd call after limit-of-2 returns `rateLimited: true` + `retryAfterMs`.
- Render filter excludes cross-ownerId facts (defence-in-depth — covers both the ScopeInvariantError path at write time and the filter path for legacy data).

**Test coverage updates:** `MemoryWritePluginNextGen.test.ts` "mentions every tool" now asserts `memory_set_agent_rule` appears in the instructions block (guards against adding the tool to the bundle but forgetting to instruct the agent on it). Stale header JSDocs in 4 test files synced.

**Typo fix.** "from a ambient inference" → "from an ambient inference" in `MemoryWritePluginNextGen.WRITE_INSTRUCTIONS`.

All 4954 tests pass. Library rebuilt, memlab typecheck clean.

### Ingestor batching + graceful-shutdown contract + imperative-request guard

Four correlated fixes around `SessionIngestorPluginNextGen`.

- **Batching.** New `SessionIngestorPluginConfig.minBatchMessages` (default **6**). Natural `onBeforePrepare` triggers now short-circuit below the threshold. Previously the hook fired every turn, which on reasoning models (gpt-5-mini at default medium effort) cost ~20s per turn for trivial exchanges. Default 6 means ~3 user/assistant pairs per batch; set to `1` for per-turn ingest. The plugin stores the most recent snapshot even when it skips, so a later `flush()` can use it.
- **Graceful-shutdown API.** New public `async flush(snapshot?: PluginPrepareSnapshot): Promise<void>`. Bypasses the batching threshold, awaits the LLM call, advances the watermark. Safe to call from destroy paths. Takes an optional snapshot override for hosts that build their own. `destroy()` is unchanged — still sync, still just flips the destroyed flag — so the documented contract is: `await plugin.flush(); plugin.destroy();`. We do NOT attempt to hook into JavaScript garbage collection — `FinalizationRegistry` can't safely perform async I/O at GC time, and pretending otherwise would look robust while dropping data. Hosts ARE responsible for calling `flush()` on browser-close / DDP-disconnect / idle-timeout / SIGINT / SIGTERM. If that matters for your deployment, keep `minBatchMessages` small or layer a write-ahead transcript journal on top.
- **Imperative-request guard in the extractor prompt.** When the user says "remind me to X", "schedule Y", "track Z", those are agent-action requests, not ambient facts. The extractor used to synthesize `has_task`, `due_date`, `assigned_to` facts for them — even across multi-turn clarifications where the agent asked "what time?" and the user replied "9am" without any tool call. New rule: skip entirely. If the agent handled it via a `memory_*` tool call, the re-extract rule covers it; if the agent didn't, the extractor must NOT fabricate the action on the agent's behalf. Exception: fact-form statements ("I have a doctor appointment on April 30") remain extractable as events.
- **Agent "no lying" + "act decisively" rules** in `MemoryWritePluginNextGen.WRITE_INSTRUCTIONS`. New "Never lie about memory writes" section: the agent MUST NOT claim to have saved / scheduled / reminded anything unless it actually called a write tool this turn with an `ok` result. Phrases like "I'll remind you" with no preceding tool call are now explicitly named as lies. New "Act decisively" section: for imperative task requests the agent fills defaults (9 AM local time, medium priority, private visibility) rather than asking; clarifying questions are restricted to genuine DATE ambiguity.

**Tests added (11 new):** batching threshold behavior (below-threshold skip, exactly-at-threshold fires, default 6), `flush()` forces ingest below threshold, flush no-op before any prepare, explicit snapshot override, idempotency after watermark advance, no-op on destroyed plugin, imperative-request extractor prompt rule, agent "no lying" rule + forbidden phrases, agent "act decisively" rule with concrete defaults. Existing 18 plugin instantiations updated to set `minBatchMessages: 1` for per-turn test semantics.

**memlab `/chat-auto`:** removed the force-trigger-after-each-turn hack. Now relies on natural batching. On `/back`, `/exit`, SIGINT, or SIGTERM, calls `await sessionIngestor.flush()` first. Shows `[final flush — extracting deferred batch]` when the trailing batch produces facts.

**Docs (`docs/MEMORY_GUIDE.md`):** updated the SessionIngestor section to reflect the new batching + tool-call visibility + imperative-request guard. New "Host integration" subsection with Meteor, signal-handler, one-shot, and idle-timeout patterns, plus explicit "no GC safety net" caveat.

**memlab models:** extraction + profile generator moved to `gpt-4.1` (non-reasoning, fast). Chat stays on `gpt-5.4`. gpt-5-mini's medium reasoning overhead on structured JSON extraction was the root cause of the 20-second latency.

### Ingestor dedup fix — transcript now carries tool-call args + results

Ambient ingestion was re-extracting facts the agent had already written via its own `memory_*` tool calls. Root cause: `renderMessage` in `SessionIngestorPluginNextGen` collapsed tool calls to `[tool:memory_upsert_entity]` — the args were dropped, so the extractor LLM couldn't see what had been captured. Paired with "ignore tool-call blocks" guidance in the prompt, this was nominally correct but unusable in practice (the LLM still saw the user's "remind me to call the doctor" message and dutifully extracted `due_date`, `assigned_to`, `has_task` — all already encoded in the agent's `memory_upsert_entity({type:'task', metadata:{dueAt:...}})` call).

- **`renderMessage` now renders tool calls with serialized, truncated JSON args.** Format: `[tool_call <name> <json>]` with args capped at 500 chars (per-call). Tool results render as `[tool_result ok <json>]` or `[tool_result error <message>]` with payload capped at 240 chars, so the extractor can also tell successful writes apart from failed ones (failed writes remain extraction-eligible — ambient is the safety net). Exported from the context-nextgen plugin barrel as `renderSessionMessage` for host apps that want a consistent transcript shape.
- **Extraction prompt strengthened** with a concrete rule keyed off the new markers: when `[tool_call memory_*]` is paired with `[tool_result ok]`, the JSON args are already persisted — do NOT re-extract *any* fact that restates, paraphrases, or decomposes what's inside, even if the user's message verbatim repeated it. A worked example inline shows which predicates to avoid when a `memory_upsert_entity({type:'task', ...})` is present (`has_task`, `assigned_to`, `due_date`, `deadline`, `task_name`, `title` — all duplicates).
- **Ordering fix in `renderMessage`:** type-tagged parts (`tool_call`, `tool_result`) now take precedence over the generic `text` / `content` string fallback. Previously, a tool_result with `content: 'error message'` rendered as plain text instead of `[tool_result error …]`, leaking error strings into the transcript as if they were assistant speech.
- **Tests added (8 new):** prompt assertions for the new tool_call / tool_result shape + duplicate-prevention examples + failed-write-remains-extractable rule; `renderMessage` direct behavioral tests for plain content, array text, tool_call with args, truncation cap, tool_result ok/error tagging, `is_error` flag handling, and tool_call with no args.

### Memory is subconscious — agent must never discuss it with the user

Follow-up fix on the memory-write prompts. Agents were narrating memory operations to the user ("I tried to link X but couldn't find…", "Should I remember this?", "Preferred display name? Visibility: private or group?"). Memory is supposed to be like a private notebook — the user should never know it exists.

- **`MemoryWritePluginNextGen.WRITE_INSTRUCTIONS`** gets a new top-of-block section: **"Memory is SUBCONSCIOUS — never discuss it with the user"**. Explicit forbidden patterns (with paraphrase prohibition): "I'll remember that.", "I saved that.", "Should I remember this?", any question about display name / visibility / entity type / domain / identifier / confidence. The user doesn't know these concepts exist. Counter-example given: "Nice to meet you, Anton." — NOT "I've saved that your name is Anton."
- **New "Recover from memory failures silently" section.** When `memory_link` fails with "no entity", the agent must `memory_upsert_entity` it silently and retry — not ask the user for a display name / visibility. Any persistent failure → drop the memory task and continue answering the user's original question without mentioning the failure. Memory is best-effort infrastructure.
- **Clarifying questions rule updated.** The existing "ask at most one" rule now explicitly says that question must be about the real-world tool choice (e.g. "Calendar or Todoist?"), never about memory internals.
- **Standard-predicate vocabulary section added** to WRITE_INSTRUCTIONS so agent writes match the ingestor's predicate choice (dedup works). Names should be `full_name` / `preferred_name` (NOT `name`); affiliations `works_at` / `member_of` (NOT `employer`); etc. Explicit `DO NOT use` entries for `name`, `employer`, `job`, `mentioned_by`.
- **`memory_link` example** now includes the auto-upsert-then-retry guidance inline, so the LLM sees the correct sequence for the failure case.
- **Privacy-default sentence** rewrites to say "Use `visibility:"group"` or `"public"` only when the user explicitly signals the fact should be shared — do NOT ask about visibility." Previously it just described the mapping; now it forbids asking.
- **7 new prose assertions** in `MemoryWritePluginNextGen.test.ts` covering: subconscious rule + forbidden phrases + "Nice to meet you" counter-example, silent-recovery rule + upsert-on-link-fail, best-effort failure posture, one-non-memory-question rule with real-world-tool example, standard predicate list + explicit anti-list, no-asking-about-visibility rule. 20 tests total pass on this file now.

### Memory prompts — tool-selection principle + entity-type docs + noise cleanup

User testing of the read/write split surfaced two prompt-level gaps. Fixes:

- **`MemoryWritePluginNextGen.WRITE_INSTRUCTIONS` rewritten** to teach the LLM *when memory is the right tool* rather than *when to call each tool*. The earlier version invited the agent to write memory aggressively. The rewrite:
  - Frames memory as "knowledge YOU (the agent) need to remember across conversations" and says explicitly it is NOT a substitute for real-world integrations.
  - Adds a "check for a dedicated connector tool FIRST" block naming the usual suspects (calendar, task tracker, notes, email) so the LLM knows to defer.
  - Adds WHEN-RIGHT / WHEN-WRONG rules with the background-extractor aware: "user conversing about themselves → do nothing, the background pipeline captures it."
  - Replaces the phrase-list of triggers with a conservation rule: "If unsure, ask ONE targeted clarifying question, then act on reasonable defaults. Do not ask five questions."
  - Adds an **Entity types section with worked examples** for `task`, `event`, `person`, `organization`, plus the subject-fact / document-fact / correction patterns — so the LLM has a concrete template rather than inventing shapes. State vocabulary for tasks exposed (`pending | in_progress | blocked | deferred | done | cancelled`).
- **`MemoryPluginNextGen.MEMORY_INSTRUCTIONS` now documents entity types for retrieval.** Lists conventional types with their metadata fields (`task.{state, dueAt, priority, assigneeId, projectId}`, `event.{startTime, endTime, location, attendeeIds}`) and a concrete `memory_find_entity` example for listing open tasks. Previously the agent had no way to know tasks were a first-class type worth querying.
- **`SessionIngestorPluginNextGen` extraction prompt tightened:**
  - Replaced the three-bucket partition with two primary targets (USER facts + OTHER entities). Agent learnings (`m_agent`) moved into a separately-rendered subsection that is *omitted entirely under `minimal` and `normal` diligence* and only appears under `thorough` with a strict evidence gate (explicit correction, failed attempt, or domain-specific constraint).
  - Elevated the anti-pattern rule from a blocklist to a **shape rule**: "if a predicate describes the utterance event itself — that something was said, asked, mentioned, discussed — it's transcript, not knowledge." Concrete illustrations (`was_mentioned_in_conversation`, `asked_about`, `talked_about`, `discussed_in`, `brought_up`, `came_up_in`, `said`, `told`, `acknowledged`…) are given as examples of the principle, not an exhaustive blocklist — the LLM is instructed to apply the rule to *any* similar predicate.
  - Added explicit "do NOT re-extract agent tool-writes" instruction. When the agent uses its own memory write tools for explicit user requests (create task, schedule event, remember X), those writes are in the transcript; the extractor should skip them. The extractor's job is the AMBIENT layer — facts the user revealed without explicitly asking the agent to record.
  - Two-question self-check added before any fact is emitted: (1) does this fact teach a stranger something specific about the subject that isn't already in the mention? (2) is this predicate about the world, or about what happened in the conversation?
- **memlab `/chat-auto` flipped to `memoryWrite: true`.** With the new decision principle in the write plugin's instructions, the agent now has all 10 tools but only writes on explicit request. Background ingestion handles the rest. `/chat` keeps the same configuration but without the background ingestor — useful as an A/B baseline.
- **Design doc for deferred follow-up** at `docs/designs/FUTURE_TOOL_PRIORITY_HINTS.md` captures the "schema-level `priorityHint` on `ToolFunction`" idea that came up during design. Not implemented — prose-only is enough for now. Doc explains conditions under which to revisit.
- **Tests added (8 new, all in plugin-test files):** (a) `MemoryWritePluginNextGen` prose now asserts the connector-first principle, wrong-tool rule, entity-type examples, state vocabulary, and one-clarifying-question guidance; (b) `MemoryPluginNextGen` prose asserts entity-type retrieval guidance with a metadataFilter example; (c) `SessionIngestorPluginNextGen` prose asserts the shape rule appears, concrete forbidden predicates are listed, agent-learnings section is absent under `minimal`/`normal` and present with evidence gates under `thorough`, and the no-re-extract-agent-writes instruction is in place.

### Memory refactor — self-review pass

Follow-up fixes on top of the read/write split landed in the same release:

- **Stale doc strings referencing `memory_find_entity(action:"upsert")`.** `src/tools/memory/remember.ts` (ghost-write error message) and `src/tools/memory/ownership.ts` (`ownerlessSubjectWarning`) still told the LLM to call the deprecated form. Both now point at `memory_upsert_entity`.
- **`MemoryWritePluginNextGen.writePermissions` dead field removed.** Declared but never used; violates the repo rule against designing for hypothetical future requirements. Removed along with its unused `Permissions` import.
- **`MemoryPluginNextGen` instructions contradicted the write plugin.** The read-plugin instructions used to assert "these tools are READ ONLY — you cannot write memory directly", which was false when the write plugin was also registered. Rewrote to describe retrieval only and defer write-side language to whatever the write plugin (or an external ingester) provides — avoids a self-contradicting system message when both plugins are active.
- **Unchecked type cast on sibling plugin lookup.** `AgentContextNextGen.initializePlugins` used `this._plugins.get('memory') as MemoryPluginNextGen | undefined` to find the read plugin before wiring `getOwnSubjectIds` on the write plugin. Replaced with an `instanceof` check so a pathological scenario (someone manually registering a different plugin under the name `memory`) falls back to the default no-op callback instead of misusing a foreign plugin's missing `getBootstrappedIds` method.
- **Test coverage for the new split.** New files:
  - `tests/unit/core/context-nextgen/plugins/MemoryWritePluginNextGen.test.ts` (13 tests) — constructor guards, exact-5-tool contract, no-overlap with read plugin, instructions present, `getContent` null, token accounting, `getOwnSubjectIds` threading (with and without callback), destroy lifecycle, state round-trip, and a shared-store co-op test showing write→read visibility on a single `MemorySystem`.
  - `tests/unit/core/context-nextgen/AgentContextNextGen.memoryFeatureFlag.test.ts` (6 tests) — auto-wiring behavior: `memory: true` alone registers only the read plugin (5 tools); `memoryWrite: true` without `memory: true` throws with a helpful message; both flags register both plugins and the write plugin's `getOwnSubjectIds` routes `"me"` to the read plugin's bootstrapped user entity; write plugin inherits the `MemorySystem` from `plugins.memory.memory` when `plugins.memoryWrite.memory` is unset; combined flag set yields exactly 10 unique tool names.
  - `tests/unit/tools/memory/factorySplit.test.ts` (4 tests) — `createMemoryReadTools` / `createMemoryWriteTools` return non-overlapping 5-tool bundles; `createMemoryTools` returns the 10-tool union without duplicates; every tool's JSON-schema is walked to assert no `{type: "array"}` node is missing `items` (regression guard for the OpenAI strict-validator bug that blocked chat earlier).
- **Documentation updates.** `CLAUDE.md` plugin table + "Agent integration" paragraph, `README.md` memory-tools section, `USER_GUIDE.md` quick-start + tool tables, `docs/MEMORY_GUIDE.md` chapter intro + quick-start + "Using the tools outside the plugin" + "Relationship to MemoryPluginNextGen" — all now describe the read/write split, the renamed `memory_upsert_entity` tool, and the two wiring patterns (full read+write vs read-only + background ingestor).

### Memory plugin split: reads vs writes (BREAKING)

`MemoryPluginNextGen` used to ship all 9 memory tools (reads + writes) by default. Two problems: every agent paid ~5k tokens of tool schemas per turn even when all it needed was retrieval, and there was no clean way to build "retrieval-only agent + separate ingestion pipeline" architectures without hand-filtering tools.

**Breaking changes:**
- `MemoryPluginNextGen.getTools()` now returns only the 5 read tools: `memory_recall`, `memory_graph`, `memory_search`, `memory_find_entity`, `memory_list_facts`. The `memory: true` feature flag no longer enables write capability.
- `memory_find_entity` is now read-only (actions: `find` | `list`). The `upsert` action has moved to a new tool, **`memory_upsert_entity`**, exposed by the write plugin. LLM prompts that previously sent `{action:"upsert", ...}` to `memory_find_entity` will get an "unknown action" error — migrate to the new tool name.
- Its system instructions now describe retrieval only; the "be proactive, call `memory_remember`" paragraph has moved to the write plugin's instructions.

**Additive:**
- New **`MemoryWritePluginNextGen`** — lightweight sidecar plugin that ships the 5 write tools (`memory_remember`, `memory_link`, `memory_forget`, `memory_restore`, `memory_upsert_entity`) and a write-specific instruction block. No system-message content of its own. Shares the read plugin's bootstrapped `me` / `this_agent` entity ids via a `getOwnSubjectIds` callback.
- New feature flag **`memoryWrite: true`**. Requires `memory: true` — the read plugin still owns user/agent entity bootstrap + profile injection.
- New tool factories `createMemoryReadTools()` and `createMemoryWriteTools()` exported from `@everworker/oneringai`. `createMemoryTools()` still exists as a convenience that returns all 10 (read + write) tools.
- New tool `createUpsertEntityTool()` exported for hosts that want to hand-pick tools.
- `MemoryWritePluginNextGen`, `SessionIngestorPluginNextGen`, and all their types now re-exported from the main package barrel for host-app consumption.

**To restore the old behavior**: enable both flags — `features: { memory: true, memoryWrite: true }`. Config shape is unchanged; the shared `MemorySystem` instance from `plugins.memory.memory` is used by both plugins automatically.

### New memlab mode: `/chat-auto`

Exercises the retrieval-only agent + background ingestor architecture end-to-end. Main agent uses only `memoryPluginNextGen` (read tools); a manually-registered `SessionIngestorPluginNextGen` runs after each turn using `MEMLAB_EXTRACT_MODEL` (defaults to the primary connector's `extractModel`, typically a cheaper/faster model than the chat model). After each user→agent turn, memlab forces a synchronous ingest pass and prints the new facts (predicate + subject + object) and elapsed time so the operator can watch what the plugin learned. `/chat` (full read+write) kept as-is for side-by-side comparison.

### `memory_find_entity` tool schema rejected by OpenAI strict validator

`memory_find_entity`'s `identifiers` parameter was declared as `{ type: 'array' }` with no `items` subschema. OpenAI's function-parameter validator rejects this with `400 Invalid schema for function 'memory_find_entity': In context=('properties', 'identifiers'), array schema missing items.` — making any OpenAI agent with `features.memory` unable to start a chat turn. Fixed by declaring `items` as an object schema with `kind` + `value` required (plus optional `isPrimary` / `verified`), matching the `Identifier` type. No behavior change for LLMs already supplying well-formed identifiers; only the schema declaration was wrong.

### Memory layer now re-exported from main package surface

`src/memory/*` was a first-class subsystem in the codebase (documented in CLAUDE.md, required by `MemoryPluginNextGen`) but its runtime values and types were not accessible from `import ... from '@everworker/oneringai'` — callers had to reach into internal paths that the `exports` field gated off. `src/index.ts` now re-exports the public memory surface: `MemorySystem`, `InMemoryAdapter`, `createMemorySystemWithConnectors`, `ConnectorEmbedder`, `ConnectorProfileGenerator`, `SignalIngestor`, `ConnectorExtractor`, `PlainTextAdapter`, `EmailSignalAdapter`, `CalendarSignalAdapter`, `ExtractionResolver`, `EntityResolver`, `PredicateRegistry`, `canonicalIdentifier`, plus every public type (`IEntity`, `IFact`, `ScopeFilter`, `FactFilter`, `IngestionResult`, etc.). No behavior changes; purely additive surface.

### New app: `apps/memlab`

Interactive lab for exercising the memory subsystem end-to-end. Single terminal REPL with three modes:
- `/chat` — memory-enabled `Agent` with streamed output; logs every `memory_*` tool call and its arguments/result so an operator can watch what the agent reads/writes.
- `/extract` — pastes arbitrary text (auto-detects email-shaped input and routes through `EmailSignalAdapter`, else `PlainTextAdapter`). Runs `SignalIngestor.ingest`, then prints resolved entities (new vs matched), written facts, merge candidates, and ingestion errors.
- `/browse` — direct read-only `MemorySystem` queries. Filters facts by subject/object/predicate/kind/confidence/importance/text substring; inspects entity detail + profile + fact neighborhood; lists open tasks (`listOpenTasks`) and recent topics (`listRecentTopics`); runs `semanticSearch` when an embedder is available.

Auto-registers a Connector per populated vendor API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, …). Primary connector chosen by discovery order; overrideable via `MEMLAB_PRIMARY`. In-memory adapter only; `/dump` and `/load` export/import JSON for persistence across restarts. No external deps beyond `chalk` + `dotenv`.

### Entity-type ergonomics — post-PR-4 bug fixes

Self-review of the four PRs above turned up four real bugs + one crash-safety doc gap. All fixes are additive / bug-fix; no API breakage.

- **`canonicalIdentifier` slugification was positional.** When the last object key had an `undefined` or empty-string value, NO part of the canonical id got slugified — producing values like `task:User X` (spaces, uppercase) that broke identity stability. Fix: slugify the last *non-empty* value instead of the last positional key.
- **`SignalIngestor.writeSeedFacts` accumulated duplicates on repeated sync.** Calendar polling re-ingests the same event; each pass wrote fresh `hosted` / `attended` facts. Fix: pass `dedup: true` to `addFact` — re-observation now refreshes `observedAt` without inserting.
- **LLM-routed `state_changed` facts silently dropped caller fields.** When `ExtractionResolver` routed a `state_changed` fact on a task through `transitionTaskState`, the audit fact was written with hard-coded defaults — `importance`, `confidence`, `contextIds`, `validFrom/Until`, and `summaryForEmbedding` from the extraction spec were all lost. Fix: added `TransitionTaskStateOptions.factOverrides`; the resolver populates it from the `ExtractionFactSpec`.
- **`reportWarning` cast a fabricated event through `ChangeEvent`.** `'transition.warning'` is not in the `ChangeEvent` union, so callers with exhaustive `switch(event.type)` handlers would crash on transition warnings. Fix: use `console.warn` directly with a `[MemorySystem.transitionTaskState]` prefix.
- **Documented `transitionTaskState` crash-safety.** Added a JSDoc paragraph explaining that the metadata write and audit fact are not atomic — on partial failure, metadata wins (authoritative) and the audit fact is lost.

**Tests added (4):** trailing-undefined canonical slugification, repeated calendar ingestion idempotency, LLM-supplied importance/confidence/contextIds preservation through auto-routing, single-surviving-value slugification regression.

### Entity-type ergonomics — PR-4 (calendar adapter + seed facts)

**`CalendarSignalAdapter`** — reference adapter for calendar event signals (Google Calendar, Outlook, iCal, etc.). Normalizes `{ title, description, startTime, endTime, location, organizer, attendees, kind }` into:
- One `event` entity seed with a deterministic canonical identifier (`event:<source>:<external-id-or-title+start>`) and structural metadata (`startTime`, `endTime`, `location`, `kind`).
- Person seeds for organizer + each attendee, keyed by email. Organizer deduped against attendee list.
- Seed facts for deterministic relationships: `organizer hosted event`, `attendee attended event`. Declined attendees seed as people but skip the `attended` seed fact (configurable via `skipDeclinedAttendance`).

Re-ingesting the same calendar event converges on the same entity via canonical identifier — no duplicate events across repeated fetches.

**`ParticipantSeed.metadata`** — new optional field (additive, non-breaking). Type-specific fields flow through `upsertEntityBySurface.metadata` from #1 (verbatim on create, `fillMissing` on resolve). Makes seed-phase entities carry structural data (event start/end, etc.) at first observation.

**`SeedFact` + `ExtractedSignal.seedFacts`** — adapters can emit deterministic relational facts derived from signal metadata. `SignalIngestor` writes them after seed resolution. Roles refer to `ParticipantSeed.role` values; when a role has multiple matching seeds (many attendees), one fact per pair is written. Self-facts skipped silently. Unresolved roles produce `IngestionError` entries without blocking the rest.

**`attended` + `hosted` predicates** — added to the standard predicate registry under a new `event` category (brings standard set from 9 categories to 10).

**`resolveRelatedEvents` third tier** — extends `getContext.relatedEvents` to walk facts with predicate `attended`/`hosted` and subject = target entity. Covers the case where attendance was recorded as a relational fact (calendar-seeded or LLM-extracted) rather than duplicated into `event.metadata.attendeeIds`. Respects the same 90-day recency window.

**Tests added (14):** `tests/unit/memory/integration/signals/adapters/CalendarSignalAdapter.test.ts` — pure adapter extraction + SignalIngestor end-to-end with event surfacing via `getContext.relatedEvents`.

### Entity-type ergonomics — PR-3 (extraction prompt + auto-inject)

**Prompt v2 — `defaultExtractionPrompt`.** Major tightening of extraction behavior to align with entity-first modeling:

- **New "## Parsimony" section** — "AT MOST ONE fact per distinct piece of knowledge" rule, expected fact-count calibration by signal type (trivial=0, substantive=1, multi-topic=2, transcript=3–6), plus a negative example (the "5 bad facts" pattern) and a positive rewrite (1 task entity + 1 fact). Zero-fact output is explicitly endorsed as correct.
- **Metadata on mentions in the JSON schema** — `task.state`/`dueAt`/`assigneeId`, `event.startTime`/`endTime`/`attendeeIds` go as `metadata` on the mention, NOT as separate attribute facts. Guideline #4 rewritten to enforce this.
- **State-change routing guidance** — emit a single `state_changed` fact; the memory layer routes it through `transitionTaskState` automatically. No manual `has_state` attribute facts.
- `DEFAULT_EXTRACTION_PROMPT_VERSION = 2` exported for callers who pin prompt snapshots.

**Type-aware "Known entities" rendering.** `renderKnownEntities` now surfaces type-specific details inline:
- Tasks: `state: in_progress, due: 2026-04-30`
- Events: `start: 2026-05-01T10:00Z, end: 2026-05-01T11:00Z`
- Other types: unchanged generic rendering.

The block instructs the LLM that the resolver will converge on existing rows — the prior-context hint makes re-extraction converge rather than create duplicates.

**`SignalIngestorConfig.contextHints`** — opt-in auto-injection of prior context into the prompt. Off by default (token-budget guardrail).

```ts
new SignalIngestor({
  memory,
  extractor,
  contextHints: {
    openTasks: { limit: 20 },      // or `true` for default limit
    recentTopics: { days: 30, limit: 30 },
  },
});
```

When enabled, `SignalIngestor` calls `memory.listOpenTasks` / `listRecentTopics` at the ingest scope and merges results into `knownEntities` after any caller-supplied entities. Dedupes by entity id. Fetch failures warn but don't break ingestion.

**Tests added (18):** `tests/unit/memory/integration/defaultExtractionPrompt.v2.test.ts`, `tests/unit/memory/integration/signals/SignalIngestor.contextHints.test.ts`.

### Entity-type ergonomics — PR-2 (task lifecycle)

**`MemorySystem.transitionTaskState(taskId, newState, opts, scope)`** — the canonical way to mutate `task.metadata.state` after creation. Side effects (atomic from the caller's perspective):
- Sets `metadata.state = newState`.
- Appends `metadata.stateHistory: TaskStateHistoryEntry[]` (no library cap — retention is the caller's problem).
- When `newState` is in `taskStates.terminal` and `metadata.completedAt` is unset, sets `metadata.completedAt = at`.
- Writes a `state_changed` fact with `value: { from, to }`, `sourceSignalId`, and `importance: 0.7` for audit + retrieval.

Validate modes: `'warn'` (default — out-of-matrix transitions route through `onError` and proceed), `'strict'` (throws `InvalidTaskTransitionError`, no writes), `'none'`. Supply the transition matrix via `opts.transitions: { from: [allowedTo...] }`.

**LLM auto-routing.** `ExtractionResolver` intercepts `state_changed` facts where the subject is a `type: 'task'` entity and routes them through `transitionTaskState` so the side effects fire as part of extraction. Tolerant value shapes: `{ from, to }`, `{ to }`, plain string. Non-task subjects + malformed values fall through to plain `addFact`. Opt out via `MemorySystemConfig.autoApplyTaskTransitions: false`.

**`MemorySystem.listOpenTasks(scope, opts?)`** + **`listRecentTopics(scope, opts?)`** — convenience fetchers for prompt injection. `listOpenTasks` filters by configured `taskStates.active`, supports `assigneeId`/`projectId`, sorts client-side by `dueAt` asc (undefined last) then `updatedAt` desc. `listRecentTopics` filters by `updatedAt >= now - days` client-side. Both clamp limits to `[1, 200]`.

**Tests added (25):** `tests/unit/memory/MemorySystem.transitionTaskState.test.ts`, `tests/unit/memory/MemorySystem.listHelpers.test.ts`.

### Entity-type ergonomics — PR-1 (foundational primitives)

Three additive changes to the memory layer that make task/event/topic entities first-class for LLM-driven ingestion. Zero breaking changes.

**`UpsertBySurfaceInput.metadata`** — carries type-specific fields (task `state`/`dueAt`/`assigneeId`, event `startTime`/`endTime`, etc.) at upsert time. On create: set verbatim. On resolve (existing entity): conservative `fillMissing` merge by default — incoming keys only fill absent slots, existing values are never overwritten. Guardrail against LLM re-extraction silently flipping `state` or `dueAt`. Opt into shallow-overwrite via `UpsertBySurfaceOptions.metadataMerge: 'overwrite'` when the caller is authoritative (sync job from a system of record). `ExtractionMention.metadata` flows through from the extractor so the LLM can populate these fields directly.

**`canonicalIdentifier(type, parts)`** + `slugify(text, opts)` — new helpers in `src/memory/identifiers.ts`. Build deterministic `{ kind: 'canonical', value: '<type>:<part>:...' }` identifiers for entities that lack a natural external strong key (tasks, events, topics, calendar entries). Using `'canonical'` uniformly means Tier-1 identifier match in `EntityResolver` converges re-extractions on the same entity across signals — follow-up emails, transcripts, and calendar updates all find the right task. `'canonical'` is documented as a blessed identifier kind in `types.ts`.

**`MemorySystemConfig.taskStates`** — configurable task-state vocabulary. Default preserves legacy behavior (`active: ['pending','in_progress','blocked','deferred']`, `terminal: ['done','cancelled']`). Apps using different lifecycles (`'proposed' | 'scheduled' | ...`) override here instead of hardcoding state strings in metadata queries. Drives `getContext.relatedTasks` filtering. Validated at construction (both non-empty, disjoint, no duplicates). Read via `memory.taskStates`.

**Tests added (30):** `tests/unit/memory/identifiers.test.ts`, `tests/unit/memory/resolution/upsertMetadata.test.ts`, `tests/unit/memory/MemorySystem.taskStates.test.ts`.

### Mongo `$graphLookup` traversal — correctness pass

Four issues found and fixed in `MongoMemoryAdapter.nativeGraphTraverse`. Three were silent divergences from the generic BFS path; one was a blocker for the most important real-world query pattern (co-subject / "who works with X?").

**Fixed — off-by-one depth overshoot.** `$graphLookup.maxDepth = N` returns `N+1` levels of documents (0..N), but our outer `$match` already emits depth-1 edges. The code passed `opts.maxDepth - 1`, producing one extra level: `opts.maxDepth = 2` returned depths 1–3 instead of 1–2. Now `opts.maxDepth - 2`, with a short-circuit that skips `$graphLookup` entirely when `opts.maxDepth ≤ 1` (outer `$match` alone suffices).

**Fixed — `asOf` silently dropped on the Mongo path.** The outer `$match` and `restrictSearchWithMatch` filter had no temporal clauses. Generic BFS honored `asOf` via `findFacts`; the native path ignored it. Point-in-time queries produced different results per backend. Fixed by inlining the same three-clause `asOf` filter (`createdAt ≤ asOf`, `validFrom ≤ asOf OR missing`, `validUntil ≥ asOf OR missing`) into both the outer `$match` and the `restrictSearchWithMatch`.

**Fixed — `opts.limit` now caps edges, not just nodes.** The contract is "max total edges returned", but the prior code limited only node resolution. On dense graphs with the off-by-one bug, callers saw hundreds of edges with `limit: 100`. Now `allEdges` is truncated to `limit` before node resolution.

**Fixed — CRITICAL: `direction: 'both'` now falls back to generic BFS.** Each `$graphLookup` pipeline fixes its direction for the whole chain (`connectFromField` / `connectToField` are static) — firing two separate pipelines (one out, one in) walked two pure chains but missed the per-hop direction flip needed for co-subject queries. From Anton, the Mongo native path reached Everworker (out) but never discovered John (needs Everworker ← works_at ← John, an inbound flip). Now `direction: 'both'` dispatches to `genericTraverse`, which correctly considers both directions at each hop. Pure `out` / `in` continue on the native fast path with the three bug fixes applied.

### Tool `memory_graph` — expanded description with query patterns

Rewrote the tool description from a short paragraph + 4 examples into a comprehensive pattern catalog that teaches the LLM to build the right query shape for each question type. Seven named patterns with concrete JSON examples:

- **Pattern A — one-hop outbound** ("Where does Anton work?" → `direction:'out', maxDepth:1, predicates:['works_at']`)
- **Pattern B — one-hop inbound** ("Who attended Q3 planning?" → `direction:'in', maxDepth:1, predicates:['attended']`)
- **Pattern C — CO-SUBJECT (two-hop, both)** — the critical idiom: "Who works with Anton?" / "Who attended the same meetings as Alice?" / "Who reports to the same manager?". Requires `direction:'both', maxDepth:2, predicates:['...']`; co-subjects appear at `depth:2` in the returned nodes.
- **Pattern D — transitive chain** (management hierarchy: `direction:'out', maxDepth:6, predicates:['reports_to']`)
- **Pattern E — neighborhood** (everything connected within N hops, any predicate)
- **Pattern F — multi-predicate filter** (professional graph: `predicates:['works_at','reports_to','collaborated_with']`)
- **Pattern G — point-in-time** (`asOf` with strict ISO-8601)

Also added a "How to read the result" section explaining the node/edge shape + depth semantics, plus "When NOT to use this tool" pointing LLMs to `memory_recall` / `memory_search` / `memory_list_facts` for wrong-shape queries.

**Tests added (5):** native-path pipeline-shape assertions in `tests/unit/memory/adapters/mongo/MongoMemoryAdapter.test.ts` — direction-both fallback (no aggregate call, co-subject discovery works), maxDepth=1 skips $graphLookup, maxDepth=3 uses graphLookup.maxDepth=1, asOf clauses appear in pipeline, edge-limit respected.

**Fixed (follow-up review):**
- **Tool description examples used bare-string names (e.g. `"start":"Anton"`) which the resolver treats as entity IDs, not surface forms.** Every pattern example would have failed at runtime (resolver calls `getEntity("Anton")` → null → error). Converted every name-based start to `{"surface":"Anton"}` across Patterns A–G and the "How to read the result" example. Added an explicit preamble so future readers know bare strings are entity IDs, not names. `"me"` / `"this_agent"` still the two valid bare-string tokens.
- **`opts.limit` now caps EDGES (not nodes) on BOTH backends** — previously, `genericTraverse` (which serves all `direction:'both'` queries including on Mongo) limited nodes, while the new native path limited edges. The tool description promises edge-based. `genericTraverse` refactored accordingly: during BFS, break the outer loop once `edges.length >= limit`, and resolve endpoints for every accumulated edge (no separate node cap). Node count is naturally bounded at `2*limit + 1`. Matches `memory_graph`'s advertised contract.
- **Native path sorts edges by depth before slicing** — accumulation order previously interleaved `[row1:depth1, row1:depth2, row1:depth3, row2:depth1, …]`, so a tight `limit` could drop depth-1 sibling edges in favor of a deeper chain from the first outer row. Now `.sort((a,b) => a.depth - b.depth).slice(0, limit)` preserves BFS-style nearest-first ordering, matching the behavior of `genericTraverse`.
- **Dropped the erroneous node cap in the native path's resolve loop** — after the edge cap, `visited` can hold up to `2*edgeLimit + 1` ids, but the loop was stopping at `edgeLimit` resolutions, so returned edges referenced endpoints missing from `nodes`. Now resolves every referenced entity for consistency.
- Added a "Backend dispatch" subsection to the tool description noting that `direction:'out'|'in'` uses native `$graphLookup` while `direction:'both'` always uses iterative BFS.

**Tests added (4 new, 1 rewritten):** L-1 depth-1 predicate-filter regression in `MongoMemoryAdapter.test.ts`; M-1 shallow-edges-preferred-under-limit; M-2 edges-nodes-consistent-under-limit; `GenericTraversal.test.ts` — "respects limit" rewritten from node-based to edge-based assertions.

### Session learning ingestor — `SessionIngestorPluginNextGen` (NEW)

Agent-run → memory learning pipeline. The plugin observes the accumulated conversation before every `AgentContextNextGen.prepare()` (specifically BEFORE compaction, so no messages are lost), extracts structured facts via a dedicated cheap-model LLM call, dedupes against existing memory, and LLM-merges details on duplicate matches. Fire-and-forget — the next turn sees whatever has been persisted by then. Optional; registers like any NextGen plugin.

**Plugin surface** (`src/core/context-nextgen/plugins/SessionIngestorPluginNextGen.ts`):
- Required config: `memory`, `agentId`, `userId`, `connectorName`, `model` — NO defaults on the connector. Host must explicitly wire the extraction backend (typically Haiku / gpt-5-mini, separate from the main agent).
- `diligence: 'minimal' | 'normal' | 'thorough'` (default `'normal'`) tunes prompt directives: explicit-only vs. standard vs. aggressive-inference.
- Side-effect plugin — `getContent` returns null, `getTools` returns [], no system-message contribution. Writes directly into memory via `memory.addFact` + `memory.updateFactDetails`.
- Watermark persisted via `getState`/`restoreState` — only the delta since last ingest is processed each run.
- Self-bootstraps `person:<userId>` + `agent:<agentId>` entities (identifier-keyed upsert is idempotent with `MemoryPluginNextGen`'s bootstrap).
- Graceful degradation — extractor/merger failures log but never block `prepare()`. Duplicate merge falls back to keeping existing details (option a — lossy but safe).
- In-flight guard — if a previous ingest is still running when the next turn fires, the new hook is skipped (no pile-up).

**Three-bucket extraction prompt** (`buildSessionExtractionPrompt`):
- Pre-bound labels `m_user` / `m_agent` so user + agent facts route to the right subject entity without round-tripping through the LLM.
- Explicit buckets: USER facts (on `m_user`), AGENT learnings (on `m_agent`, including `learned_pattern` / `refined_procedure` / `avoided_pitfall`), OTHER entities (new mentions for people/orgs/projects/events).
- Diligence directives injected by level.
- Validity period calibration section (teaches `validUntil` with ephemeral / task-bound / identity rules).

**Context-framework hook** — new optional lifecycle method on `IContextPluginNextGen`:
- `onBeforePrepare(snapshot: PluginPrepareSnapshot): void` — fires at the top of `AgentContextNextGen.prepare()` BEFORE system-message assembly and compaction, so side-effect plugins can observe the conversation before any eviction. Snapshot is read-only (messages + currentInput). Throws are caught + logged; this hook must never break `prepare()`. Default implementation: no-op (existing plugins stay unchanged).

**Memory-layer additions:**
- `MemorySystem.addFact({..., dedup: true})` — opt-in dedup path. On exact match (same subject, canonicalized predicate, kind, value, objectId) against a non-archived fact: returns the existing fact, bumps its `observedAt`, does NOT insert. Keeps the collection lean for re-observed facts ("anton works_at everworker" repeated every session → one row).
- `MemorySystem.updateFactDetails(id, details, scope)` — in-place details update. Recomputes `isSemantic` (merged text may cross the 80-char threshold), clears stale embedding, re-embeds if an embedder is configured. Used by the ingestor to apply LLM-merged details on dup matches. Mutates the fact — prior details are lost; use supersession when audit history is needed.
- `MemorySystem.findDuplicateFact(input, scope)` — public lookup helper. Predicate canonicalization via registry. Used by the ingestor to split insert vs. merge paths before writing.

**Default extraction prompt update** (`defaultExtractionPrompt.ts`):
- New `## Validity period` section teaching `validFrom` / `validUntil` with calibration examples (ephemeral / task-bound / project-bound / identity / superseded). Fields were already plumbed end-to-end (stored, filtered by adapter `asOf`, no behaviour change at runtime) but the prompt never asked for them — so every extracted fact ended up "valid forever". Now the LLM knows to emit them.

**Tests added (21):**
- `tests/unit/memory/MemorySystem.dedup.test.ts` — 8 tests covering dedup hit/miss, observedAt bump, archived re-insert, `findDuplicateFact`, and `updateFactDetails` recompute + re-embed.
- `tests/unit/core/context-nextgen/plugins/SessionIngestorPluginNextGen.test.ts` — 13 tests covering constructor guards, side-effect contract, watermark round-trip + userId-mismatch drop, happy-path extract + write, dedup + merge flow, merge-failure fallback (option a), in-flight guard, and prompt-composition checks (three buckets, diligence levels, validity section).

**Internal refactor:**
- `parseExtractionResponse` moved from `signals/ConnectorExtractor.ts` into a standalone `src/memory/integration/parseExtraction.ts` so callers can parse LLM output without importing `Agent` (which would reintroduce an `Agent ↔ plugins` cycle at module-load time). `ConnectorExtractor` re-exports the same symbol for backward compatibility.

**Fixed (post-ship review):**
- **H-1 — id-based watermark (data loss).** Previously the watermark was an index into `AgentContextNextGen._conversation`. Compaction mutates that array (creates a filtered copy), so after the first compaction the index became stale and NEW messages were silently skipped. Watermark is now `lastIngestedMessageId: string | null` — it tracks a stable `Message.id`; if the id was compacted away, the plugin falls back to "take all" (dedup protects from duplicate writes). State version bumped v1 → v2; legacy v1 state resets to null.
- **H-2 — ghost-write guards on bootstrap + mentions (security/integrity).** The session ingestor called `memory.addFact` directly, bypassing the tool-layer ghost-write guard that `memory_remember` enforces. (1) If bootstrap returns a user/agent entity not owned by the current user (e.g. a group-readable shared entity owned by someone else), the plugin now disables itself for the session and logs an error. (2) If a mention upsert returns a foreign-owned entity, the mention is dropped from `labelToId` — facts referencing it are silently skipped with a warning. Prevents planting facts under another user's ownership.
- **H-3 — truncation-aware watermark (correctness).** `buildTranscript` previously truncated from the head while the watermark advanced to the end — meaning head messages past the char budget were silently lost. Now walks FORWARD including messages until budget exhausted, and advances the watermark to the LAST message that fit. Messages that didn't fit remain "not yet ingested" and will be processed on the next turn.
- **M-1 — `addFact({dedup:true})` now requires write access before bumping `observedAt`.** On `canAccess(existing, scope, 'write') === false`, falls through to the normal insert path rather than silently mutating a foreign fact.
- **M-2 — `findDedupMatch` value comparison uses `stableEqual`.** Key-sorted deep equality; `JSON.stringify`-based comparison previously produced false negatives on object values with different key orders and false positives on NaN/Infinity.
- **M-3 — `AgentContextNextGen.prepare()` catches async rejections from `onBeforePrepare`.** Previously only sync throws were caught; an `async onBeforePrepare()` that rejected would produce an unhandled promise rejection. Now any thenable return is monitored via `.catch` + console.warn.
- **M-4 — Destroy checkpoints in the ingest pipeline.** `ingest()` re-checks `this.destroyed` after every async await; if destroyed mid-flight, bails without calling `addFact` / `updateFactDetails` on a stale agent.
- **L-1 — Prompt-injection-resistant delimiters.** Extraction + merge prompts now use per-call random-nonce XML tags (`<conversation_${nonce}>`, `<existing_${nonce}>`, etc.) instead of fixed names, so user content can't close the delimiter and inject instructions.

**Tests added (11):**
- `tests/unit/memory/MemorySystem.dedup.test.ts` — 3 new (M-1 write-check, M-2 key-order equality, M-2 array-order distinction).
- `tests/unit/core/context-nextgen/plugins/SessionIngestorPluginNextGen.test.ts` — 5 new (H-1 compaction-survival, H-2 bootstrap disable, H-2 mention drop, H-3 truncation watermark, v1-state reset).
- `tests/unit/core/context-nextgen/AgentContextNextGen.onBeforePrepare.test.ts` — NEW file, 3 tests (sync throw catch, async rejection catch, snapshot shape).

### Memory tools + extraction — kind enforcement & logical consistency pass

Ten new tests, all green at 4707 total. Focuses on three leaks that were all silent-data-corruption vectors for LLM-driven writes, plus four ergonomic fixes surfaced during the review.

**`kind` validation — three layers (N-1).** An LLM-emitted `"kind": "note"` previously leaked through the extraction prompt, `ExtractionResolver`, and `MemorySystem.addFact` untouched — storage ends up with a string that orphans the fact from `computeIsSemantic`, `findFacts({kind: 'atomic'})`, graph traversal, and profile-regen gating. Now:
- `defaultExtractionPrompt` renders an explicit `## Fact kinds` section with when-to-pick-which guidance; inline comment replaced with "MUST be exactly atomic OR document".
- `ExtractionResolver` validates `spec.kind`; unknown values coerce to `'atomic'` and land in `result.unresolved` with a `unknown kind "X", coerced to "atomic"` warning (same channel as `newPredicates`).
- `MemorySystem.addFact` rejects any non-`'atomic' | 'document'` kind at the boundary — defense in depth.

**`memory_remember` now supports `kind: 'document'` (N-2).** Previously hardcoded to `'atomic'`; agents could read the documents tier via `memory_recall({include:['documents']})` but never populate it. Added a `kind?: 'atomic' | 'document'` arg with JSON-schema enum (LLM constrained at the schema layer) and description guidance on when to pick each. `memory_remember_document` is not a separate tool.

**`value` / `objectId` mutual exclusion (N-3).** `memory_remember` and `MemorySystem.addFact` now reject writes that set both. Previously stored both, creating records that matched both predicate+value and predicate+objectId queries ambiguously.

**`memory_link` now takes `details` (N-4).** Asymmetric with `memory_remember` before — LLMs had no way to annotate *why* two entities are linked without falling back to `memory_remember` with `objectId`. Passed through to `addFact` (relational facts with `details` are already valid in the memory layer).

**`memory_search` filter accepts `SubjectRef` (N-5).** New `filter.subject` / `filter.object` fields accept the full `SubjectRef` shape (`"me"`, `"this_agent"`, entity id, `{identifier}`, `{surface}`). Previous `subjectId` / `objectId` raw-id fields retained as escape hatches. Eliminates the "resolve-then-search" two-call pattern.

**`memory_graph.asOf` strict ISO validation (N-6).** Invalid date now returns a structured error — consistent with `memory_search.observedAfter`/`observedBefore`. Previously silently dropped the filter.

**`MemorySystem.addFact` confidence/importance clamp at the boundary.** Defense-in-depth — mirrors the tool-layer clamp so direct callers (tests, custom ingestion) can't plant undislodgeable top-ranked facts.

**`memory_find_entity` polish (N-7/N-8).** Description now clarifies `by.type` + `by.metadataFilter` are list-only (they were silently ignored for `find`). Documented that `identifiers[].exclusive: true` passes through to upsert for canonical identifiers (email, phone) — prevents the same identifier attaching to two entities.

### Memory plugin + tools — second security pass

Deep review of how LLM-controllable inputs flow from the tool layer into `MemorySystem`. Two new high-severity integrity bugs fixed, plus medium correctness fixes. Eleven new tests (4699 total, green).

**Fixed — ghost-writes rejected (HIGH, integrity).** `memory_remember` and `memory_link` now refuse writes whose subject/`from` is owned by another user. The memory layer enforces `fact.ownerId == subject.ownerId`, so previously an LLM-controlled write against a foreign entity silently attributed the fact to the foreign owner — a victim's profile regeneration could pick up fabricated observations. Tools return a structured error naming the foreign owner; no fact is written.

**Fixed — `contextIds` cross-owner injection (HIGH, cross-user leak).** If a fact's `contextIds` include entities the caller doesn't own and the chosen visibility is `"group"` or `"public"`, the tool now silently downgrades visibility to `"private"` and returns a `warnings` entry explaining why. Without this, a compromised agent could plant a world-readable fact with `contextIds: [victim]` that showed up in the victim's graph-walk (findFacts-by-touchesEntity). Applied in `memory_remember`, `memory_link`, and `memory_forget.replaceWith`.

**Fixed — confidence/importance unbounded (MEDIUM, ranking corruption).** Both are now clamped to `[0, 1]` in the tool layer via a new `clampUnit()` helper. `importance: 1e9` could previously plant a fact that permanently dominated `topFacts` across every profile injection until archived.

**Fixed — `memory_forget` supersession now inherits predecessor `kind` (MEDIUM, correctness).** Previously hardcoded `kind: 'atomic'`, which broke document-fact supersession (the updated doc wouldn't surface under `include: 'documents'`). Now `kind: predecessor.kind`.

**Fixed — `memory_link` default visibility now follows the `from` subject class (MEDIUM, configuration correctness).** Previously always used `defaultVisibility.forOther`, ignoring host config like `defaultVisibility.forAgent='group'`. Now matches `memory_remember`: picks `forUser` / `forAgent` / `forOther` based on the subject.

**Fixed — `memory_recall` `include` enum tightened (LOW, UX).** Dropped `'tasks'` and `'events'` from the schema + description — they were silently ignored. Related tasks + events are controlled via `minimal:true/false`.

**Fixed — `MemoryPluginNextGen.restoreState` drops stale entity ids on `userId` mismatch (LOW, correctness).** If the host rebinds the plugin to a different user, persisted entity ids from the prior scope are now discarded and the plugin re-bootstraps on the next `getContent`. `getState` already carried `userId`; `restoreState` now honours it.

**Fixed — error-message interpolation resilient to non-Error throws (LOW, UX).** New `toErrorMessage(err)` helper falls back to `String(err)` for strings/plain objects that adapters might throw. Was previously `"memory_<tool> failed: undefined"`.

**New helpers in `src/tools/memory/types.ts`:** `clampUnit(v)` (clamp to `[0, 1]` or undefined) and `toErrorMessage(err)` (safe string).

**Tests added (11):** ghost-write rejection on `memory_remember` + `memory_link.from`; foreign `to` still allowed; contextIds downgrade + pass-through; `confidence`/`importance` clamp; predecessor-`kind` inheritance; `memory_link` default-visibility per subject class; restoreState stale-id drop + match.

### Memory plugin + tools — `MemoryPluginNextGen` and 8 `memory_*` LLM tools (NEW)

Self-learning knowledge store for agents, end-to-end. The plugin bootstraps a `person` entity for the user and an `agent` entity for the agent in the memory layer; injects both profiles into the system message on every turn; and ships 8 LLM-callable tools so the agent can read and write memory during its own thinking loop. Observations flow in through the tools, profile regeneration synthesises them incrementally, and the next turn sees the updated profile — no manual prompt engineering.

**New plugin** (`src/core/context-nextgen/plugins/MemoryPluginNextGen.ts`):
- Feature flag `memory: true` + `plugins.memory.memory: MemorySystem` opts in. Requires `userId` per the memory layer's owner invariant.
- Injects ONLY two blocks: `## Agent Profile (...)` and `## Your User Profile (...)`. Each block configurable via `agentProfileInjection` / `userProfileInjection` (`topFacts` default 20, optional `factPredicates` whitelist, `relatedTasks`, `relatedEvents`, `identifiers`).
- Entity bootstrap is idempotent via identifier-keyed upsert + an in-flight promise lock.
- Graceful degradation — memory-layer errors log via `logger.warn` and return a placeholder, never fail context prep.

**New tools** (`src/tools/memory/`):
- `memory_recall` — profile + top-ranked facts + optional tiers (documents, semantic, neighbors, tasks, events) for any subject.
- `memory_graph` — N-hop traversal; dispatches to Mongo native `$graphLookup` when available, else iterative BFS.
- `memory_search` — semantic text search across visible facts.
- `memory_find_entity` — lookup/list/upsert by id, identifier, surface, or type+metadata. Upsert auto-merges identifiers on existing entities (multi-ID enrichment).
- `memory_list_facts` — paginated raw fact enumeration; `archivedOnly: true` switches to the audit view.
- `memory_remember` — write an atomic fact. Be proactive. Visibility mapping: `private` → `{group:'none', world:'none'}`, `group` → `{group:'read', world:'none'}`, `public` → library defaults.
- `memory_link` — write a relational fact between two entities.
- `memory_forget` — archive a fact, optionally superseding with `replaceWith` (preserves audit chain).
- Factory `createMemoryTools({ memory, agentId, defaultUserId, defaultGroupId, ... })` for standalone use.

**Flexible subject reference** — every tool that takes an entity accepts `SubjectRef`: entity id, `"me"`, `"this_agent"`, `{id}`, `{identifier: {kind, value}}` (any of the entity's many IDs), or `{surface: "..."}` (fuzzy resolution). Ambiguous surfaces return a `candidates` array the LLM can pick from rather than throwing.

**Security model — trust boundary preserved:**
- `userId` + `groupId` come from **plugin config** (authenticated host context), never from LLM tool arguments. Tools silently ignore `groupId` in args — an earlier iteration that honoured it was a group-scope escalation path.
- All LLM-controllable numeric limits clamped: `maxDepth ≤ 5`, `topK ≤ 100`, `limit ≤ 200/500`, `topFactsLimit ≤ 100`, `neighborDepth ≤ 5`. Protects against DoS via absurd arguments.
- `memory_search` date filters strictly ISO-8601; invalid strings return a structured error instead of silently dropping the filter.

**Deprecations (non-breaking):**
- `UserInfoPluginNextGen` and `PersistentInstructionsPluginNextGen` are marked `@deprecated`. They keep working unchanged; new code should prefer `MemoryPluginNextGen`. The memory plugin supersedes both with facts-over-KV, supersession-preserved history, LLM-synthesised profiles, three-principal permissions, and semantic recall.

**Tests (+66):**
- `tests/unit/core/context-nextgen/plugins/MemoryPluginNextGen.test.ts` — bootstrap, injection config, fresh-render behavior, graceful degradation, tool wiring, state round-trip, trusted-groupId flow.
- `tests/unit/tools/memory/memoryTools.test.ts` — one describe per tool covering SubjectRef variants, visibility → permissions, `archivedOnly` semantics, DoS clamping, security regression (groupId arg ignored), strict date validation.

**Docs:**
- `docs/MEMORY_GUIDE.md` — new section 14 "Giving agents memory" covers plugin config, bootstrap, all 8 tools with examples, security model, standalone tool usage, relation to deprecated plugins.
- `CLAUDE.md` — Memory plugin added to NextGen plugin table; UserInfo + PersistentInstructions marked deprecated; Memory Layer section now references the agent-side integration.

### Memory layer — incremental profile regeneration (BREAKING for custom `IProfileGenerator` implementations)

`MemorySystem.regenerateProfile` now drives its generator with **deltas only** instead of the full fact window — faster, cheaper, and avoids the generator re-litigating claims the prior profile already captured.

**Interface change:** `IProfileGenerator.generate` now takes a single `ProfileGeneratorInput` (new type in `src/memory/types.ts`):

```ts
interface ProfileGeneratorInput {
  entity: IEntity;
  newFacts: IFact[];            // observedAt > prior.createdAt, archived=false. First regen: all atomic facts.
  priorProfile: IFact | undefined;
  invalidatedFactIds: FactId[]; // supersession predecessors + direct-archived-since
  targetScope: ScopeFields;
}
```

Previous signature `generate(entity, atomicFacts, priorProfile, targetScope)` is gone. `ConnectorProfileGenerator` + `defaultProfilePrompt` updated in lockstep. The default prompt now treats the prior profile as authoritative and instructs the LLM to drop claims backed by invalidated fact IDs.

**Migration:** custom `IProfileGenerator` implementations must switch to the options-object signature. Ignoring the new fields reproduces the old behavior (minus the input size saving).

**Public API additions on `MemorySystem`:**
- `listEntities(filter, opts, scope)` — pass-through to the store's `listEntities` for tool-layer consumers.
- `findFacts(filter, opts, scope)` — pass-through for raw fact enumeration.
- `getFact(id, scope)` — pass-through for supersede paths + diagnostics.

### Memory layer — access control (BREAKING)

Three-principal permission model layered on top of the existing scope system. Every entity and fact now carries an optional `permissions: { group?, world? }` block with `AccessLevel = 'none' | 'read' | 'write'` (write implies read). Owner always has full access unconditionally.

**New types / errors / functions (`src/memory/AccessControl.ts`):**
- `AccessLevel`, `Permission`, `Permissions`, `AccessControlled` types.
- `canAccess(record, caller, need)`, `effectivePermissions(record)`, `assertCanAccess(record, caller, need, recordKind)`, `levelGrants(level, need)` pure evaluators — backend-agnostic source of truth for access semantics.
- `PermissionDeniedError` (carries `recordId`, `recordKind`, `operation`) and `OwnerRequiredError` (carries `recordKind`) thrown by MemorySystem.
- `DEFAULT_GROUP_LEVEL = 'read'`, `DEFAULT_WORLD_LEVEL = 'read'` constants.

**Type additions:**
- `IEntity.permissions?`, `IFact.permissions?` (propagates through `NewEntity`/`NewFact` via Omit).

**Enforcement:**
- Read paths filter via `canAccess(..., 'read')` at the adapter layer. `InMemoryAdapter` uses an in-process predicate; `MongoMemoryAdapter.scopeToFilter` rewritten to produce an `$or` of three branches (owner shortcut, group match with group level ≠ 'none', world match with world level ≠ 'none').
- Write paths (`archiveEntity`, `deleteEntity`, `archiveFact`, `supersedeFact`, `mergeEntities`, `addFact` with `supersedes`, `upsertEntity` dirty path) load the record first and call `assertCanAccess(..., 'write')` — throws `PermissionDeniedError` when denied.
- Cascades (`archiveEntity`, `deleteEntity`, `mergeEntities → rewriteFactReferences`, `archiveFactsReferencing`, `rewriteFactsForDeletion`) silently skip facts the caller can see but cannot write — documented permission-window caveat.

**Breaking changes / migration:**
- **Owner required.** `upsertEntity` / `addFact` throw `OwnerRequiredError` when neither input nor `scope.userId` provides one. Admins can set `ownerId` to any user id (no equality check enforced). Migration: backfill legacy records with a system `ownerId`; add `userId` to test scopes or pass explicit `input.ownerId`.
- **Public-read defaults.** Previously a record with `{groupId: 'acme', ownerId: 'alice'}` was invisible outside `acme` (scope isolation). Now default `world: 'read'` makes it readable by anyone. To preserve the old group-private behavior, set `permissions: { world: 'none' }` explicitly at write time.
- **Stricter writes.** Previously any caller in scope could mutate; now non-owner callers require explicit `permissions.group = 'write'` or `permissions.world = 'write'`. Expect `PermissionDeniedError` in places that silently succeeded before.

**Tests:**
- 29 pure evaluator tests (`tests/unit/memory/AccessControl.test.ts`) covering level × need × principal matrix, defaults, error classes.
- 19 end-to-end tests (`tests/unit/memory/MemorySystem.permissions.test.ts`) covering owner-required invariant, admin delegation, write-path denial for each mutation method, read-filtering via scope + permissions, cascade respects write permission.
- Existing adapter + resolver + predicate tests updated (scope-isolation tests now opt in to `permissions: { world: 'none' }` to preserve their semantics). 4605 total unit tests green (+48 from permissions).

**Docs:**
- New `docs/MEMORY_PERMISSIONS.md` — model, the three principals, access levels, defaults table, owner invariant, admin delegation, read filter vs write auth, recipes (team-private note, owner-private note, public reference, wiki-editable, group-collaborative task), migration notes, adapter contract, pitfalls.
- `docs/MEMORY_API.md` — new "Access Control" section with enforcement table + error classes + pure evaluator signatures; new exports entry; TOC updated.
- `docs/MEMORY_GUIDE.md` — scope section opens with permissions cross-link + owner invariant callout; four-scope table rewritten to reflect public-read defaults.
- `CLAUDE.md` — memory-layer key-invariants block updated.

### Memory layer — signal ingestion pipeline

**New high-level ingestion facade** (`src/memory/integration/signals/`) — turns raw source documents (email, plain text, custom sources) into entities + facts with deterministic participant seeding from metadata, so identity ambiguity for senders/recipients is eliminated upstream of the LLM.
- `SignalIngestor` — orchestrates seed → prompt → extract → resolve. Methods: `ingest` (by adapter kind), `ingestText` (escape hatch), `ingestExtracted` (lowest level). `registerAdapter` / `hasAdapter` for runtime adapter management.
- `SignalSourceAdapter<TRaw>` — pluggable per-source adapter contract (`kind` + pure `extract(raw) => ExtractedSignal`).
- `ParticipantSeed` — metadata-derived entity seed (strong identifiers required; weak-name seeding rejected).
- `IExtractor` — pluggable LLM call contract (`extract(prompt) => Promise<ExtractionOutput>`).
- `ConnectorExtractor` — default `IExtractor` implementation wrapping a Connector + model via `runDirect` with `responseFormat: { type: 'json_object' }` and defensive parsing (`parseExtractionResponse`).
- `PlainTextAdapter` — reference adapter for raw text signals.
- `EmailSignalAdapter` — reference adapter for email signals: seeds `from/to/cc` as `person` participants with `email` identifiers; opt-in (default on) seeds non-free email domains as `organization` participants; BCC intentionally dropped for privacy; common free providers (`gmail.com`, `outlook.com`, …) filtered from org seeding.

**ExtractionResolver preResolved support**
- `ExtractionResolverOptions.preResolved: Record<label, EntityId>` — pre-bound label map that bypasses `upsertEntityBySurface` for participants already resolved upstream. LLM-emitted mentions that redeclare a pre-resolved label are silently skipped (pre-bound wins).
- `defaultExtractionPrompt` accepts `preResolvedBindings` and renders a "Pre-resolved labels" block instructing the LLM to reference them directly and not redeclare them in `mentions`.

**Docs**
- New `docs/MEMORY_SIGNALS.md` — usage guide with architecture diagram, email/plain-text quickstarts, custom-adapter walkthrough, custom-extractor recipe, seed semantics, known-entities vs pre-resolved comparison, result handling, pitfalls.
- Cross-linked from `MEMORY_API.md` (new Signal ingestion API subsection + exports table) and `MEMORY_GUIDE.md` (extraction pipeline section).

### Memory layer — hardening + predicate library

**Predicate registry docs**
- New `docs/MEMORY_PREDICATES.md` — dedicated usage guide with recipes (setup patterns, extending the standard library, custom vocabularies, auto-supersession, LLM prompt integration, drift monitoring, strict mode, ranking weights).
- Cross-linked from `MEMORY_API.md` and `MEMORY_GUIDE.md`.

**Safety / correctness fixes (memory layer)**
- `ConnectorEmbedder` now validates returned vectors: wrong dimensions or non-finite values throw immediately instead of silently poisoning cosine-distance retrieval.
- `MemorySystem.addFact` rejects empty/whitespace predicates and self-referential facts (`subjectId === objectId`) at entry regardless of predicate mode.
- `MongoMemoryAdapter.metadataFilter` hardened: keys starting with `$` or containing `.` are rejected; values whitelisted to literal scalars/arrays/Dates or `{$in: [...]}`. Protects callers forwarding user input against `$where` / `$function` / `$regex` injection.
- Identity-embedding dedup: `upsertEntity` / `appendAliasesAndIdentifiers` skip re-embedding when the composed identity string is unchanged, avoiding wasted embedder calls.
- `mergeEntities` error messages distinguish "not found" from "not visible in caller scope".
- `searchEntities` (InMemoryAdapter + MongoMemoryAdapter) now ranks results by relevance: exact displayName > exact alias > displayName substring > alias substring > identifier substring.
- `MemorySystem.addFact` normalizes empty `contextIds: []` to `undefined` on write.

**Observability**
- New `ChangeEvent` variant `fact.embedding.failed` — emitted once per embedding job that exhausts all retries (carries `factId`, `entityId`, `attempts`, `reason`). Lets operators surface dead-letter signals rather than silently dropping embeddings.
- New `MemorySystemConfig.onError(error, event)` hook — routes `onChange` listener exceptions to a dedicated handler. Falls back to `console.warn` when unset (previously swallowed silently).

**Entity resolution**
- Fuzzy/typo-tolerant resolution (old tier 4 + tier 5) removed. Rationale: scanning an arbitrary N-entity pool silently degrades with dataset size. The proper replacement is entity-level semantic search over `identityEmbedding` (requires a new `IMemoryStore.semanticSearchEntities` capability on adapters) and is planned for a future release. Identity embeddings continue to be populated today so the future wiring is a drop-in.
- `EntityResolutionConfig.minFuzzyRatio` and `.fuzzyCandidatePoolSize` removed.
- `normalizedLevenshteinRatio` utility removed; `normalizeSurface` retained (still used by exact-match tiers to handle "Inc.", case, punctuation).
- Exact-match search now also tries the normalized surface, so `"Microsoft Inc."` finds `"Microsoft"` via corporate-suffix stripping.

**Predicate Registry** — pluggable fact-predicate vocabulary for the memory layer (`src/memory/predicates/`)
  - `PredicateRegistry` class + `PredicateDefinition` type with canonical name, category, aliases, default importance, ranking weight, `singleValued`/`isAggregate` semantics, and LLM-prompt metadata
  - `PredicateRegistry.standard()` — 51-predicate starter library across 9 categories (identity, organizational, task, state, communication, observation, temporal, document, social)
  - `PredicateRegistry.empty()` — for fully custom vocabularies
  - Canonicalization: camelCase/dash/whitespace → snake_case, alias resolution (case-insensitive)
  - `renderForPrompt()` — markdown vocabulary block for injection into LLM extraction prompts; configurable `maxPerCategory` cap
  - `toRankingWeights()` — merges registry weights into `RankingConfig.predicateWeights` (user weights win on collision)
  - `MemorySystemConfig.predicates` (optional registry), `predicateMode: 'permissive'|'strict'` (default permissive), `predicateAutoSupersede: boolean` (default true)
  - `MemorySystem.addFact`: canonicalizes predicates; applies `defaultImportance`/`isAggregate`; auto-supersedes `singleValued` predecessors (scope-bounded); rejects unknowns in strict mode
  - `MemorySystem.canonicalizePredicate`, `hasPredicateRegistry`, `getPredicateDefinition` public methods
  - `defaultExtractionPrompt` accepts `predicateRegistry` + `maxPredicatesPerCategory`; renders vocabulary block when present
  - `ExtractionResolver.IngestionResult.newPredicates` — deduped list of canonicalized unknowns seen in LLM output (vocabulary-drift signal)
  - 76 new unit tests; full memory suite (19 files, 401 tests) + full project suite (4509 tests) green
- **TemplateEngine** — Extensible template substitution for agent instructions (`src/core/TemplateEngine.ts`)
  - `{{COMMAND}}` and `{{COMMAND:arg}}` syntax with colon-separated arguments
  - Two-phase processing: **static** handlers resolve once at agent creation (AGENT_ID, AGENT_NAME, MODEL, VENDOR, USER_ID), **dynamic** handlers resolve every LLM call (DATE, TIME, DATETIME, RANDOM)
  - Custom date formatting: `{{DATE:MM/DD/YYYY}}`, `{{TIME:hh:mm A}}`, `{{DATETIME:YYYY/MM/DD HH:mm}}`
  - Random number generation: `{{RANDOM:min:max}}`
  - Triple-brace escaping: `{{{DATE}}}` → literal `{{DATE}}`
  - Raw block escaping: `{{raw}}...{{/raw}}` → content preserved verbatim
  - Fully extensible: `TemplateEngine.register('COMPANY', () => 'Acme Corp')` with async handler support
  - Phase-aware: handlers declare `{ dynamic: true }` for per-call resolution, static by default
  - `process()` (async) and `processSync()` APIs with phase filtering
  - Built-in handlers can be overridden by client apps (e.g., replace `DATE` with timezone-aware version)
  - Integrated into Agent constructor (static pass) and AgentContextNextGen.buildSystemMessage (dynamic pass)

## [0.5.3] - 2026-04-10

### Added
- **Google Workspace Connector Tools**: 11 new tools for Google APIs, auto-registered with ConnectorTools for the `google-api` service type:
  - `create_draft_email` — Create a draft email in Gmail, optionally as a reply
  - `send_email` — Send an email or reply via Gmail with HTML body support
  - `create_meeting` — Create a Google Calendar event with optional Google Meet link
  - `edit_meeting` — Update an existing Google Calendar event
  - `get_meeting` — Get full details of a single calendar event
  - `list_meetings` — List calendar events in a time window
  - `find_meeting_slots` — Find available meeting time slots via Google freeBusy API
  - `get_meeting_transcript` — Retrieve Google Meet transcript from Google Drive
  - `read_file` — Read a file from Google Drive as markdown (Docs, Sheets, Slides, PDF, images, etc.)
  - `list_files` — List files/folders in Google Drive
  - `search_files` — Full-text search across Google Drive
  - Shared `googleFetch()` helper with service-account and OAuth support, error handling, and multi-account awareness
- **Zoom Connector Tools**: 3 new tools for Zoom API, auto-registered with ConnectorTools for the `zoom` service type:
  - `zoom_create_meeting` — Create instant or scheduled Zoom meetings
  - `zoom_update_meeting` — Update existing meeting settings (topic, time, duration, waiting room, etc.)
  - `zoom_get_transcript` — Download and parse cloud recording transcripts (VTT → structured speaker-attributed text)
  - Shared `zoomFetch()` helper, `parseMeetingId()` (URL or numeric), `parseVTT()` transcript parser
  - Zoom vendor template with OAuth (user token) and Server-to-Server OAuth auth templates
- **Unified Calendar Tool** (`find_meeting_slots`): Cross-provider meeting slot finder that aggregates busy intervals from multiple calendar systems (Google, Microsoft, etc.) and computes unified free slots where all attendees are available. Supports attendee-to-provider mapping for routing attendees to correct calendar backends.
  - `ICalendarSlotsProvider` interface for pluggable calendar backends
  - `createGoogleCalendarSlotsProvider()` and `createMicrosoftCalendarSlotsProvider()` adapters
  - 15-minute granularity slot scanning with configurable duration and time window
- **Multi-Account Connector Support**: Agents can now use multiple accounts per connector (e.g., `microsoft:work` + `microsoft:personal`) with automatic account resolution:
  - `connectorAccounts` field on `ToolContext` — per-connector account binding map
  - `ConnectorTools.withAccountBinding()` — unified 4-tier account resolution (explicit → context.accountId → connectorAccounts map → legacy)
  - `resolveConnectorContext()` helper for consistent userId/accountId extraction in tool factories
  - `AuthIdentity.toolFilter` — restrict which tools are generated per identity
  - `ToolManager.mergeToolContext()` — partial context updates without wiping existing fields
  - `AgentContextNextGen.syncToolContext()` auto-builds `connectorAccounts` from single-account identities
  - `BaseAgent.registerIdentityTools()` — auto-generates and registers connector tools from agent identities
  - `ToolCatalogRegistry` multi-account support: `connector:name:accountId` category format, per-account tool discovery via `forIdentities()`
- **Microsoft Tools Enhancements**:
  - `get_meeting` — Get full details of a single calendar event (new tool)
  - `list_meetings` — List calendar events in a time window with join URLs (new tool)
  - Rich reply support — `send_email` and `create_draft_email` now prepend HTML body above quoted original for threaded replies
- **Tool Permissions Bypass** (`autoApproveAll`): New `PermissionPolicyManager` option that auto-approves all tools without interactive checks. Blocklist still respected for safety. Use for autonomous/scheduled execution where no approval UI exists.
- **Integration Testing Framework**: Reusable test suite system for connector tools, exported as public API:
  - `IntegrationTestRunner` — run suites against live connectors with parameterized test cases
  - 10 built-in suites: Google, Microsoft, Slack, GitHub, Telegram, Twilio, Zoom, web-search, web-scrape, generic-api
  - `registerSuite()` for custom suite registration
- **Storage Admin Bypass** (`StorageUserContext`): New `bypassOwnerScope` flag for admin operations on documents owned by other users. `resolveStorageUserContext()` normalizer for backward-compatible `string | undefined | StorageUserContext` inputs. Applied to `IRoutineDefinitionStorage` and `IRoutineExecutionStorage`.
- **OAuth Account Management**: `Connector.rekeyAccount()` to re-alias tokens (e.g., temporary ID → discovered email), `Connector.removeAccount()` to unlink accounts. `TokenStore.rekeyAccount()` and `removeAccount()` with in-memory + persistent cleanup. `authorizationParams` passthrough for custom OAuth flows.

### Fixed
- **Google OAuth refresh tokens**: Fixed refresh token handling in Google connector templates
- **Connector ID resolution**: Fixed connector ID propagation in multi-account scenarios
- **Microsoft reply-all**: Fixed `send_email` reply threading to correctly prepend new content above quoted original
- **Microsoft tool error formatting**: Consistent `formatMicrosoftToolError()` across all Microsoft tools
- **Tool adapter context propagation**: Fixed accountId/userId propagation through tool adapters
- **OAuth token storage**: Multiple OAuth flow fixes for multi-account token management

### Changed
- **ConnectorTools API simplified**: Removed `ConnectorTools.genericAPI()` and `ConnectorTools.serviceTools()` — use `ConnectorTools.for()` for everything. All tools now get unified account binding wrapper.
- **`ToolCatalogRegistry.parseConnectorCategory()`** now returns `ParsedConnectorCategory` object (with `connectorName` + `accountId`) instead of plain string
- **ToolCatalog source tags**: Connector categories use category name directly as source (e.g., `connector:microsoft:work`) instead of `catalog:connector:...` prefix

## [0.5.2] - 2026-04-08

### Added
- **Telegram Connector Tools**: 6 new tools for Telegram Bot API, auto-registered with ConnectorTools for the `telegram` service type:
  - `telegram_send_message` — Send text messages with optional formatting (HTML/Markdown)
  - `telegram_send_photo` — Send photos by URL or file_id
  - `telegram_get_updates` — Poll for incoming messages/events (long-polling support)
  - `telegram_set_webhook` — Set or remove webhook for push updates
  - `telegram_get_me` — Get bot info (connection test)
  - `telegram_get_chat` — Get chat/group/channel info
  - Shared `telegramFetch()` helper with Bot API token-in-URL pattern, error handling, and timeout management
- **Twilio Connector Tools**: 4 new tools for SMS and WhatsApp messaging via Twilio, auto-registered with ConnectorTools for the `twilio` service type:
  - `send_sms` — Send SMS text messages to any phone number
  - `send_whatsapp` — Send WhatsApp messages (freeform text or pre-approved templates via ContentSid)
  - `list_messages` — List/filter messages by phone number, date range, and channel (SMS/WhatsApp/all)
  - `get_message` — Get full details of a single message by SID (status, price, errors)
  - Shared `twilioFetch()` helper with Account SID resolution, form-encoded POST, and Twilio error handling
  - Phone number helpers: `normalizePhoneNumber()`, `toWhatsAppNumber()`, `getAccountSid()`
  - Twilio template now supports `optionFields` for default SMS/WhatsApp phone numbers
- **Context Size Guardrail**: Pre-flight context limit enforcement across all LLM providers (OpenAI, Anthropic, Google, Vertex). Estimates input token count before each LLM call and auto-trims messages if they exceed the model's context window, leaving space for the response. Safety net for `runDirect()`/`streamDirect()` paths that bypass `AgentContextNextGen.prepare()`.
- **Orchestrator v2**: Major upgrade to the agent orchestrator with conversational delegation model:
  - 3-tier routing: DIRECT (orchestrator handles) / DELEGATE (hand session to sub-agent) / ORCHESTRATE (multi-agent coordination)
  - `delegate_interactive` tool — hand the user-facing session to a sub-agent with monitoring and auto-reclaim
  - All-async execution model (orchestrator never blocks on sub-agents)
  - Rich agent type descriptions (`description`, `scenarios`, `capabilities`) for intelligent routing
  - Optional `autoDescribe` — LLM-generated descriptions for agent types at creation time
  - `skipPlanning` option to bypass UNDERSTAND/PLAN/APPROVE phases
  - `DelegationDefaults` for configurable monitoring mode and reclaim conditions
  - Orchestrator can now have its own `tools` for DIRECT-route tasks
- **Excel Markdown-KV Format**: New `markdown-kv` table format for ExcelHandler — converts each row to a record block with `- **Header**: value` entries, useful for LLM consumption of spreadsheet data
- **Vendor Template `optionFields`**: New `OptionField` type for declaring vendor-specific configurable options in templates. UI apps render these as form fields; values stored in `connector.config.options`
- **`AfterExecutionContext.input`**: Hook context now includes the original user input, preserved across multi-iteration executions where `getCurrentInput()` may be overwritten by tool results
- **Model Registry Updates**: Added Grok 4.20 series (reasoning, non-reasoning, multi-agent with 2M context), Gemini 3.1 Flash Live preview

### Fixed
- **Google Gemini 3+ thought signatures**: Fixed tool call round-tripping where thought signatures were lost after session save/restore. Signatures now persist on `ToolUseContent.thoughtSignature` (survives serialization) with 3-tier resolution: Content object → in-memory Map → bypass fallback
- **Google streaming duplicate tool call IDs**: Tool call IDs in `GoogleStreamConverter` now include a counter to prevent collisions when multiple tool calls occur in a single response
- **Streaming `thoughtSignature` propagation**: `TOOL_CALL_START` stream events now carry `thought_signature` field; `StreamState` and `Agent._addStreamingAssistantMessage()` propagate signatures through the streaming pipeline
- **Multi-iteration streaming text accumulation**: `StreamState.accumulateFrom()` merges text, reasoning, and statistics from per-iteration state into global state, fixing missing text in final response for multi-turn agentic streams
- **UserInfo plugin session restore merge**: After restoring from a session snapshot, the plugin now merges newer entries from storage (e.g., from onboarding seed or dreaming service) instead of using stale snapshot data only
- **Basic Auth connector encoding**: `buildAuthConfig()` now correctly base64-encodes `user:password` per RFC 7617 for Basic Auth connectors (Twilio, Jira, Zendesk, Bitbucket, Mailgun)
- **Agent error logging**: Agent failure logs now include rich error details (status, code, type, cause chain, error body) via `ProviderErrorMapper.extractErrorDetails()` instead of just `error.message`
- **`createConnectorFromTemplate` vendorOptions**: Template-created connectors now support passing `vendorOptions` which are stored in `connector.config.options`

### Changed
- **Orchestration tools reduced from 7 to 5**: `assign_turn` now auto-creates agents and is always async with optional `autoDestroy`. `assign_parallel` removed (use multiple `assign_turn` calls). New `delegate_interactive` replaces direct `create_agent` + `assign_turn` for user-facing delegation.
- **Model Registry Cleanup**: Removed deprecated models — Claude 3 Haiku, Grok 4/3/2 legacy series, Gemini 3 Pro preview

### Removed
- Deprecated Grok models: `grok-4-fast-reasoning`, `grok-4-fast-non-reasoning`, `grok-4-0709`, `grok-code-fast-1`, `grok-3`, `grok-3-mini`, `grok-2-vision-1212`
- Deprecated Anthropic model: `claude-3-haiku-20240307`
- Deprecated Google model: `gemini-3-pro-preview`

## [0.5.1] - 2026-04-01

### Added
- **Per-Call `RunOptions`**: `agent.run(input, options?)` and `agent.stream(input, options?)` now accept an optional `RunOptions` parameter to override `thinking`, `temperature`, and `vendorOptions` per invocation. Enables controlling reasoning effort at each agentic step without changing agent-level config.
- **`thinking` in `DirectCallOptions`**: `runDirect()` and `streamDirect()` now also support the vendor-agnostic `thinking` config (`enabled`, `budgetTokens`, `effort`).
- **Tool Catalog: `listAll` parameter** — `tool_catalog_search({ listAll: true })` returns every tool across all available categories and connectors, grouped by category. Includes tool metadata (name, displayName, description, safeByDefault) plus loaded/pinned status per category, and `totalCategories`/`totalTools` counts. Respects `categoryScope` and `identities` scoping.

### Fixed
- **Multi-turn Anthropic "must end with user message" error**: Fixed a bug in `AgentContextNextGen.setCurrentInput()` that appended the previous assistant message to `_currentInput`, causing the conversation sent to the API to end with an assistant message on the second+ `run()` call. This triggered Anthropic's "This model does not support assistant message prefill" error.
- **Anthropic converter safety net**: Added trailing assistant message trimming in `AnthropicConverter.convertMessages()` as a defensive measure against any future context-layer bugs that could produce conversations ending with an assistant message.

## [0.5.2] - 2026-03-17

### Added
- **Embedding Capability**: First-class embedding support following the same capability-based pattern as Image, Video, TTS, and STT. Multi-vendor embedding generation with a unified API.
- **`Embeddings` Class**: High-level capability class with `Embeddings.create({ connector, model?, dimensions? })` factory. Supports single and batch embedding with per-call model/dimension overrides.
- **`IEmbeddingProvider` Interface**: Provider interface with `embed(options)` method returning typed `EmbeddingResponse` (embeddings, model, usage). Extends `IProvider`.
- **`createEmbeddingProvider(connector)` Factory**: Routes to the correct vendor-specific provider. Supports OpenAI, Google, Ollama, Groq, Together, Mistral, DeepSeek, Grok, and Custom vendors.
- **`OpenAIEmbeddingProvider`**: Uses the OpenAI SDK for embedding generation. Also serves as the provider for all OpenAI-compatible vendors (Ollama, Mistral, Together, etc.) via baseURL and name overrides. Supports `dimensions` parameter for MRL-capable models.
- **`GoogleEmbeddingProvider`**: Uses Google's `embedContent` and `batchEmbedContents` REST API with `outputDimensionality` support.
- **Embedding Model Registry**: Comprehensive metadata for 10 embedding models across 4 vendors:
  - **OpenAI (3)**: `text-embedding-3-small` (1536d, MRL), `text-embedding-3-large` (3072d, MRL), `text-embedding-ada-002` (legacy, inactive)
  - **Google (1)**: `text-embedding-004` (768d, MRL, free tier)
  - **Mistral (1)**: `mistral-embed` (1024d)
  - **Ollama (5)**: `qwen3-embedding` (4096d, 8B, #1 MTEB multilingual), `qwen3-embedding:4b`, `qwen3-embedding:0.6b` (1024d, ~400MB), `nomic-embed-text` (768d), `mxbai-embed-large` (1024d)
- **Registry Helpers**: `getEmbeddingModelInfo()`, `getEmbeddingModelsByVendor()`, `getActiveEmbeddingModels()`, `getEmbeddingModelsWithFeature()`, `calculateEmbeddingCost()`.
- **`EMBEDDING_MODELS` Constants**: Typed constants organized by vendor (e.g., `EMBEDDING_MODELS[Vendor.OpenAI].TEXT_EMBEDDING_3_SMALL`).
- **Matryoshka Representation Learning (MRL)**: Models with MRL support allow flexible output dimensions — request fewer dimensions for faster similarity search with minimal quality loss. Tracked via `capabilities.features.matryoshka` in the registry.
- **Ollama `auth: none` Support**: Embedding factory correctly handles Ollama's `none` authentication type, matching the existing `createProvider` (text) behavior.
- **`ProviderCapabilities.embeddings`**: Optional `embeddings?: boolean` field added to `ProviderCapabilities` interface. Embedding providers set this to `true`.

### Changed
- **DRY: Shared Config Extractors**: Extracted `extractOpenAICompatConfig()`, `extractGoogleConfig()`, `extractGoogleMediaConfig()`, and `extractGrokMediaConfig()` into `src/core/extractProviderConfig.ts`. Updated `createImageProvider`, `createAudioProvider`, and `createVideoProvider` to use shared helpers instead of local copies. Eliminates 4x code duplication across factory files.

## [0.5.1] - 2026-03-15

### Added
- **Policy-Based Tool Permission System**: Complete replacement for the legacy `ToolPermissionManager`. Composable policies with deny-short-circuit / allow-continue semantics. Enforced at `ToolManager` pipeline level — ALL tool execution paths are gated (agent loop, direct API, orchestrator workers).
- **Per-User Permission Rules** (`UserPermissionRulesEngine`): Persistent, per-user rules with argument-level conditions. User rules have the HIGHEST priority — they override ALL built-in policies. Specificity-based matching (not numeric priorities). Unconditional flag for absolute overrides.
- **8 Built-in Policies**: `AllowlistPolicy`, `BlocklistPolicy`, `SessionApprovalPolicy`, `PathRestrictionPolicy` (canonicalized paths), `BashFilterPolicy` (best-effort guardrail), `UrlAllowlistPolicy` (parsed URL checking), `RolePolicy` (multi-role, deny beats allow), `RateLimitPolicy` (in-memory).
- **Approval → Rule Creation**: Approval dialog responses can create persistent user rules via `ApprovalDecision.createRule`. "Always allow" decisions automatically persist as user rules for future sessions.
- **Argument Conditions**: 8 operators (`starts_with`, `contains`, `equals`, `matches` + negations) with case-insensitive default. Meta-args (`__toolCategory`, `__toolSource`) for matching tool metadata.
- **Tool Self-Declaration**: All 50+ built-in tools now declare default `ToolPermissionConfig` (scope, riskLevel, sensitiveArgs). App developers can override at registration time.
- **Clean Architecture Storage**: `IUserPermissionRulesStorage` interface + `FileUserPermissionRulesStorage` reference implementation. Also `IPermissionAuditStorage`, `IPermissionPolicyStorage`, `IPermissionApprovalStorage`.
- **PermissionEnforcementPlugin**: `IToolExecutionPlugin` at priority 1 on ToolManager pipeline. Throws `ToolPermissionDeniedError` (new typed error).
- **Centralized Audit Redaction**: Sensitive args auto-redacted (built-in keys + tool-declared sensitiveArgs + truncation for large values).
- **Orchestrator Delegation**: `setParentEvaluator()` — parent deny is final, parent allow doesn't skip worker restrictions.
- **`agent.policyManager`**: New public getter for the `PermissionPolicyManager`. `agent.permissions` deprecated.
- **`agent.policyManager.userRules`**: CRUD API for per-user permission rules (for UI integration).

### Changed
- **`ToolContext`**: Added `roles?: string[]` and `sessionId?: string` fields.
- **`BaseAgentConfig`**: Added `userRoles?: string[]` field for role-based access control.

### Deprecated
- **`ToolPermissionManager`**: Replaced by `PermissionPolicyManager`. Legacy adapter preserved for backward compatibility.
- **`agent.permissions`**: Use `agent.policyManager` instead.

## [0.5.0] - 2026-03-15

### Added
- **`AgentRegistry` exported from main index**: `AgentRegistry` class and all its types (`AgentInfo`, `AgentInspection`, `AgentFilter`, `AgentRegistryStats`, `AgentRegistryEvents`, `AgentEventListener`) now exported from `@everworker/oneringai` for external use.
- **`AgentContextNextGen.registerPlugin()` options**: New `{ skipDestroyOnContextDestroy: true }` option for shared plugins (e.g., SharedWorkspacePlugin in orchestrator).
- **`StoreToolsManager.unregisterHandler()`**: New method to remove store handlers by storeId.
- **Everworker Desktop: Orchestrator mode**: Any agent can be designated as an orchestrator via `isOrchestrator` config flag. Orchestrator instances use `createOrchestrator()` with child agent templates built from existing agent configs.
- **Everworker Desktop: Worker event streaming**: Orchestrator instances subscribe to `AgentRegistry` events and forward worker lifecycle (created/destroyed/status), tool activity (start/end), and turn events as `orchestrator:*` StreamChunk types to the renderer.
- **Everworker Desktop: Worker inspection IPC**: New `agent:inspect-worker` and `agent:list-workers` IPC handlers for deep worker inspection via `AgentRegistry.inspect()`.
- **Everworker Desktop: Agent Editor — Orchestrator tab**: New "Orchestrator" tab in agent editor with toggle switch, child agent type picker (from existing agents), editable aliases, and max workers slider.
- **Everworker Desktop: OrchestratorDashboard**: Horizontal strip above chat messages showing worker pills with live status (idle/running/paused), current tool activity, and workspace entry count. Only visible for orchestrator tabs.
- **Everworker Desktop: Workers sidebar tab**: 4th sidebar tab (conditional on orchestrator mode) with WorkspaceView (shared workspace entries) and WorkerInspectorPanel (deep inspection via AgentRegistry with 2s polling for conversation, context budget, tool stats).

- **Unified Store Tools**: 5 generic `store_*` tools (`store_get`, `store_set`, `store_delete`, `store_list`, `store_action`) replace 19 plugin-specific CRUD tools. All IStoreHandler plugins automatically get these tools — zero boilerplate.
- **`IStoreHandler` Interface**: New interface for building custom CRUD plugins. Implement it alongside `IContextPluginNextGen` and your plugin automatically gets store tools when registered.
- **`SharedWorkspacePluginNextGen`**: New plugin for multi-agent coordination. Storage-agnostic bulletin board with inline content, external references, versioning, author tracking, and append-only conversation log. Enable via `features.sharedWorkspace: true`.
- **`StoreToolsManager`**: Central manager that routes `store_*` tool calls to the correct IStoreHandler plugin. Uses `descriptionFactory` to dynamically list available stores and their schemas.
- **Store Comparison in Tool Descriptions**: Each `store_*` tool dynamically describes all available stores with "use for / NOT for" guidance, preventing LLM confusion about which store to use.
- **Agent Orchestrator** (`createOrchestrator()`): Factory for creating an orchestrator Agent that coordinates a team of worker agents. The orchestrator is a regular Agent with orchestration tools — no subclass needed.
- **7 Orchestration Tools**: `create_agent`, `list_agents`, `destroy_agent`, `assign_turn` (blocking), `assign_turn_async` (non-blocking, leverages async tools infrastructure), `assign_parallel` (fan-out), `send_message` (inject into running/idle agents).
- **`Agent.inject()`**: New method to queue messages into a running agent's context, processed on the next agentic loop iteration. Enables orchestrator-to-worker communication during turns.
- **Async Turn Assignment**: `assign_turn_async` uses the existing async tools infrastructure (`blocking: false`) — the orchestrator continues its loop while workers execute in the background. Results are delivered via auto-continuation.
- **Workspace Delta**: Workers automatically receive a "what changed since your last turn" summary at the start of each turn, built from workspace entry timestamps.
- **Default Orchestrator System Prompt**: Auto-generated from `agentTypes` config, describes available agent types, coordination tools, and workflow patterns.
- **`src/core/orchestrator/`**: New module with `createOrchestrator.ts` (factory + system prompt), `tools.ts` (7 orchestration tool definitions), and `index.ts` (exports).

### Added
- **Orchestrator unit tests**: 68 tests covering `buildOrchestrationTools` (all 7 tools, workspace delta builder, validation, timeouts, partial failures), `createOrchestrator` (factory, system prompt, worker creation, destroy lifecycle, config options).

### Fixed
- **Dead `timers` array in `assign_parallel`**: Removed unused `timers` array and `timers.push(timer)` — individual timer cleanup already happens in per-promise `finally` blocks.
- **Everworker Desktop: React anti-pattern in child agent selector**: Replaced `document.getElementById` DOM manipulation with controlled React state (`selectedChildAgentId`).
- **Everworker Desktop: Array index as key for child agent list**: Changed `key={idx}` to stable `key={agentConfigId-alias}` to prevent wrong re-renders on deletion.
- **Everworker Desktop: Silent polling errors in WorkerInspectorPanel**: Added error state — shows "Unable to inspect worker" message instead of being stuck on "Loading..." forever.
- **Everworker Desktop: Poll interval magic number in WorkerInspectorPanel**: Extracted to `const POLL_INTERVAL_MS = 2000`.
- **[CRITICAL] Timer leaks in orchestration tools**: `assign_turn`, `assign_turn_async`, and `assign_parallel` now properly clear timeout timers in `finally` blocks when `agent.run()` resolves before the timeout. Previously leaked 1+ timers per tool call.
- **[CRITICAL] Shared workspace double-destroy**: When orchestrator is destroyed, the shared workspace plugin is no longer destroyed from worker contexts (only from the orchestrator). Added `registerPlugin(plugin, { skipDestroyOnContextDestroy: true })` option.
- **[CRITICAL] Worker agents not cleaned up on orchestrator destroy**: `orchestrator.destroy()` now destroys all worker agents and clears the shared workspace.
- **SharedWorkspacePlugin `compact()` callback**: `compact()` now triggers `onEntriesChanged` callback when entries are removed, matching `storeSet`/`storeDelete`/`storeAction('clear')` behavior.
- **SharedWorkspacePlugin token cache in `enforceMaxEntries()`**: Token cache is now properly invalidated after entries are evicted by the max-entries limit.
- **SharedWorkspacePlugin callback leak on destroy**: `onEntriesChanged` callback is cleared on `destroy()` to prevent keeping external objects alive.
- **Injection queue type safety**: `_pendingInjections` is now typed as `Message[]` instead of `InputItem[]`, eliminating unsafe casts when draining injections.
- **Injection queue unbounded growth**: `inject()` now drops oldest messages when queue exceeds 100 entries.
- **`destroy_agent` on running agent**: Now returns an error if the agent is currently running instead of destroying mid-execution.
- **Duplicate agents in `assign_parallel`**: Validates that each agent name appears only once in assignments to prevent concurrent runs on the same context.
- **Max agents limit**: `create_agent` enforces a configurable `maxAgents` limit (default: 20) to prevent unbounded agent creation.
- **Workspace delta cap**: Delta builder now caps entries (20) and log lines (10) to prevent very large deltas for agents that haven't run in a while.
- **`orchestratorAgent` used before assignment**: `parentAgentId` now uses a deferred variable set after orchestrator creation.
- **`StoreToolsManager.unregisterHandler()`**: Added missing method to remove store handlers.

### Changed
- **InContextMemoryPluginNextGen**: Now implements `IStoreHandler` (storeId: `"context"`). Old tools `context_set`, `context_delete`, `context_list` removed.
- **WorkingMemoryPluginNextGen**: Now implements `IStoreHandler` (storeId: `"memory"`). Old tools `memory_store`, `memory_retrieve`, `memory_delete`, `memory_query`, `memory_cleanup_raw` removed. Tier-specific operations available via `store_action("memory", "cleanup_raw")` and `store_action("memory", "query", {...})`.
- **PersistentInstructionsPluginNextGen**: Now implements `IStoreHandler` (storeId: `"instructions"`). Old tools `instructions_set`, `instructions_remove`, `instructions_list`, `instructions_clear` removed. Clear available via `store_action("instructions", "clear", { confirm: true })`.
- **UserInfoPluginNextGen**: Now implements `IStoreHandler` (storeId: `"user_info"`). Old tools `user_info_set`, `user_info_get`, `user_info_remove`, `user_info_clear` removed. TODO tools (`todo_add`, `todo_update`, `todo_remove`) remain independent.
- **Permission Allowlist**: Updated to include `store_get`, `store_set`, `store_delete`, `store_list`, `store_action`. Old 18 CRUD tool names removed.

### Breaking Changes
- Old CRUD tool names removed entirely (not deprecated). Client apps that enable features via `features.workingMemory: true` etc. are unaffected — tools change automatically under the hood.
- Plugin names, feature flags, programmatic APIs, and session persistence formats are all unchanged.

### Added

- **AgentRegistry — Global Agent Tracking, Observability & Control** — New static registry (`AgentRegistry`) that automatically tracks all active `Agent` instances. Agents auto-register on creation and auto-unregister on destroy — zero user effort. Provides:
  - **Query**: `get(id)`, `getByName(name)`, `filter({ name, model, connector, status, parentAgentId })`, `list()`, `count`
  - **Lightweight snapshots**: `listInfo()`, `filterInfo()` returning `AgentInfo` objects
  - **Deep async inspection**: `inspect(id)`, `inspectAll()`, `inspectMatching()` — returns full `IContextSnapshot` (plugins, tools, budget, systemPrompt), complete `InputItem[]` conversation, execution metrics, audit trail, circuit breaker states, tool stats, and child agent info
  - **Aggregate metrics**: `getStats()` (counts by status/model/connector), `getAggregateMetrics()` (total tokens, tool calls, errors across fleet)
  - **Parent/child hierarchy**: `getChildren(parentId)`, `getParent(childId)`, `getTree(rootId)` (recursive `AgentTreeNode` for visualization)
  - **Events**: `on/off/once` for `agent:registered`, `agent:unregistered`, `agent:statusChanged`, `registry:empty`
  - **Event fan-in**: `onAgentEvent(listener)` — receive ALL events from ALL agents through one callback (ideal for dashboards/logging)
  - **External control**: `pauseAgent(id)`, `resumeAgent(id)`, `cancelAgent(id)`, `destroyAgent(id)`, plus `*Matching(filter)` and `*All()` bulk variants
  - New properties on `BaseAgent`: `registryId` (UUID, unique per instance), `parentAgentId` (links to parent for agent hierarchies)
  - New config: `parentAgentId?: string` on `BaseAgentConfig` / `AgentConfig`
  - New exported types: `AgentStatus`, `AgentInfo`, `AgentFilter`, `AgentRegistryStats`, `AggregateMetrics`, `AgentTreeNode`, `AgentInspection`, `AgentRegistryEvents`, `AgentEventListener`, `IRegistrableAgent`

- **Long-Running Sessions (Suspend/Resume)** — Tools can now signal the agent loop to suspend via `SuspendSignal.create({ result, correlationId, metadata })`. When detected, the loop does a final wrap-up LLM call, saves the session and correlation mapping, and returns an `AgentResponse` with `status: 'suspended'` and a `suspension` field containing `correlationId`, `sessionId`, `agentId`, `resumeAs`, `expiresAt`, and `metadata`. Later, `Agent.hydrate(sessionId, { agentId })` reconstructs the agent from stored definition + session state, allowing the caller to add hooks/tools before calling `agent.run(userReply)` to continue. New types: `SuspendSignal`, `SuspendSignalOptions`, `ICorrelationStorage`, `SessionRef`, `CorrelationSummary`. New storage: `FileCorrelationStorage` (default, file-based at `~/.oneringai/correlations/`). New `StorageRegistry` key: `correlations`. New event: `execution:suspended`.

- **Async (Non-Blocking) Tool Execution** — Tools with `blocking: false` now execute in the background while the agentic loop continues. The LLM receives an immediate placeholder result, and when the real result arrives, it is delivered as a new user message. Supports auto-continuation (re-enters the agentic loop automatically) or manual continuation via `agent.continueWithAsyncResults()`. Configurable via `asyncTools: { autoContinue, batchWindowMs, asyncTimeout }` on `AgentConfig`. Includes 5 new events (`async:tool:started`, `async:tool:complete`, `async:tool:error`, `async:tool:timeout`, `async:continuation:start`), public accessors (`hasPendingAsyncTools()`, `getPendingAsyncTools()`, `cancelAsyncTool()`, `cancelAllAsyncTools()`), and `pendingAsyncTools` on `AgentResponse`. New exported types: `AsyncToolConfig`, `PendingAsyncTool`, `PendingAsyncToolStatus`.

### Fixed

- **Memory leak: async batch timer not cleared on destroy** — `Agent.destroy()` now clears `_asyncBatchTimer`, preventing post-destroy callbacks and GC retention of destroyed agent instances.

- **Memory leak: beforeCompactionCallback not cleared on context destroy** — `AgentContextNextGen.destroy()` now nulls out the `_beforeCompactionCallback`, breaking the Agent→Context→callback→Agent reference cycle that could prevent garbage collection.

- **Memory leak: Connector circuit breaker listeners not removed** — `Connector.dispose()` now calls `removeAllListeners()` on the circuit breaker before dropping the reference.

- **Unhandled async error in `_flushAsyncResults`** — The `setTimeout` callback that schedules async result flushing now checks `_isDestroyed` and wraps the call in try/catch with error logging.

- **Race condition: auto-save log noise during destroy** — Auto-save interval now suppresses log output if the agent was destroyed between the `_isDestroyed` check and the async `save()` completion.

- **Improved tool argument parse error messages** — `executeToolWithHooks` now provides descriptive errors when tool arguments are invalid JSON. Tracking-only parse failures now log at debug level instead of being silently swallowed.

- **Null guard on LLM response** — Agent loop now guards against null/undefined responses from `generateWithHooks` before accessing `response.output`.

### Changed

- **DRY: Shared storage utilities** — Extracted duplicated `sanitizeId`, `sanitizeUserId`, `DEFAULT_USER_ID`, `ensureDirectory`, and `getErrorMessage` into `src/infrastructure/storage/utils.ts`. Updated 8 storage files to import from shared utilities instead of maintaining local copies.

- **`InMemoryStorage`: `structuredClone()` replaces `JSON.parse(JSON.stringify())`** — Faster deep cloning with better type support (handles Date, Map, Set, etc.).

- **Async file reads in providers** — Replaced `readFileSync` with `await fs.promises.readFile` in `clipboardImage.ts`, `OpenAISoraProvider.ts`, `GrokImagineProvider.ts`, and `GoogleImageProvider.ts` to avoid blocking the event loop.

- **Stream: `_buildToolCallsFromMap()` hardcoded `blocking: true`** — Tool calls built from streaming responses now correctly read the `blocking` field from tool definitions instead of always setting `blocking: true`.

- **OpenAI stream converter memory leak** — `OpenAIResponsesStreamConverter` stored all tracking state (activeItems, toolCallBuffers, reasoningBuffers) as local variables inside `convertStream()`, never cleaned up on error. Moved to instance properties with `clear()`/`reset()`/`hasToolCalls()` methods and try/finally cleanup. `OpenAITextProvider.streamGenerate()` now calls `streamConverter.clear()` in finally block.

- **MCPClient reconnect timer leak** — `connect()` catch block called `stopHealthCheck()` but not `stopReconnect()`, leaving stale reconnect timers from previous attempts.

- **BaseTextProvider: no IDisposable, no destroyed guard** — Now formally implements `IDisposable` with `isDestroyed` flag. `ensureObservabilityInitialized()` short-circuits if destroyed. Added base `mapError()` method for common HTTP error classification (401->auth, 429->rate limit, 500+->provider).

- **Bash tool: excessive background process retention** — Completed background processes were retained for 5 minutes. Reduced TTL to 60 seconds and added `MAX_COMPLETED_PROCESSES` cap (50) with oldest-first eviction.

- **HookManager: missing IDisposable interface** — Now implements `IDisposable` with proper `isDestroyed` flag and idempotent `destroy()`.

- **FileContextStorage: index corruption on concurrent writes** — `updateIndex()` and `removeFromIndex()` had no serialization, allowing concurrent read-modify-write corruption. Added async mutex (`withIndexLock()`) wrapping all index mutations.

- **CircuitBreaker: `closed` event emitted `successCount: 0`** — `transitionTo('closed')` reset `consecutiveSuccesses` to 0 before emitting the event. Now captures the value before reset.

- **GenericOpenAIProvider: silent error swallow in `listModels()`** — Now logs caught errors at debug level instead of silently discarding.

- **ToolPermissionManager: no destroy method** — Added `destroy()` that clears all internal state and calls `removeAllListeners()`.

- **MCP subscribe/unsubscribe: `{} as any` type casts** — Replaced with proper `EmptyResultSchema` from MCP SDK.

### Changed

- **All providers: `console.log` replaced with `this.logger`** — OpenAI, Anthropic, and Google text providers now use the structured logger from `BaseTextProvider` instead of `console.log`/`console.error` for API call logging.

- **OpenAITextProvider: typed params** — Request `params` changed from `any` to `Record<string, unknown>` in both `generate()` and `streamGenerate()`.

- **webFetch.ts: proper error typing** — Outer catch changed from `catch (error: any)` to `catch (error: unknown)` with proper narrowing.

- **Response.ts: documented status union** — Added JSDoc documenting all 6 status values and their use cases (`queued` for async video, `in_progress` for streaming).

### Refactored

- **Filesystem tools: shared `walkDirectory()` async generator** — Extracted common recursive directory traversal from `glob.ts` and `grep.ts` into `walkDirectory()` in `types.ts`. Both tools now use the shared generator, eliminating ~60 lines of duplicated traversal logic.

- **MCPClient: `createMCPError()` helper** — Extracted repeated `new MCPError('Failed to X from server Y', name, cause)` pattern into a private helper, reducing boilerplate across 8 call sites.

## [0.4.8] - 2026-03-12

### Fixed

- **Agent: ToolManager listener leak** — `tool:registered` event listener on ToolManager was never removed during `Agent.destroy()`. Now stores listener reference and removes it on cleanup, preventing accumulation across agent creation/destruction cycles.

- **HookManager: No destroy method** — `HookManager` had no `destroy()` method, leaving internal `hooks`, `hookErrorCounts`, and `disabledHooks` maps alive after agent destruction. Added `destroy()` that clears all internal state.

- **CircuitBreaker: Unbounded failures array** — `failures` array could grow indefinitely within the time window under high error rates. Now capped at `max(failureThreshold * 2, 20)` after pruning.

- **Bash tool: Background process memory leak** — Background processes had no limit on concurrent count or output buffer size. Added `MAX_BACKGROUND_PROCESSES` (20) and `MAX_OUTPUT_LINES` (1000) caps.

- **RateLimiter: Unbounded wait queue** — `waitQueue` had no size limit, allowing thousands of queued promises under heavy load. Added `maxQueueSize` config (default: 500) that rejects with `RateLimitError` when exceeded.

- **StorageRegistry: No per-entry removal** — Added `StorageRegistry.remove(key)` method for cleaning up individual storage backends without resetting the entire registry.

- **BrowserService: Event listener leak on destroy** — 9+ event listeners on `webContents` were never removed in `destroyBrowser()`. Now calls `webContents.removeAllListeners()` before `close()`.

- **BaseAgent: Auto-save after destroy** — Auto-save interval callback could execute after agent destruction. Added `_isDestroyed` guard to skip saves on destroyed agents.

- **webFetch: AbortController timeout leak** — `clearTimeout` was only called on the success path. Moved to `finally` block to ensure cleanup on all error paths.

## [0.4.7] - 2026-03-10

### Added

- **Streaming TTS interface** — New `IStreamingTextToSpeechProvider` interface with `supportsStreaming()` and `synthesizeStream()` methods. Providers can opt in to chunked audio delivery. Exported `TTSStreamChunk` type.

- **OpenAI TTS streaming** — `OpenAITTSProvider` implements `IStreamingTextToSpeechProvider`. Iterates the response body stream, yielding PCM/WAV/MP3 chunks as they arrive from the API.

- **TextToSpeech streaming API** — `TextToSpeech.supportsStreaming(format?)` and `synthesizeStream(text, options?)` with automatic fallback to buffered `synthesize()` for non-streaming providers.

- **VoiceStream streaming mode** — New `streaming` config flag on `VoiceStreamConfig`. When enabled, `executeTTS()` uses `synthesizeStream()` and accumulates small API chunks into ~125ms buffers before emitting `AudioChunkReadyEvent`s with `sub_index` for sub-chunk ordering.

- **StreamEvent sub_index** — `AudioChunkReadyEvent` now has optional `sub_index` field for streaming TTS sub-chunk ordering within a text chunk.

## [0.4.6] - 2026-03-04

### Added

- **V25 & Hosea: Tool Catalog adoption** — Both apps now support `ToolCatalogPluginNextGen` features. V25 `V25ContextSettings.features` uses `ContextFeatures` from core (no type duplication). V25 `buildContextConfig()` wires `pinnedCategories` and `toolCategoryScope`. Hosea adds 3 flat fields (`toolCatalogEnabled`, `pinnedCategories`, `toolCategoryScope`) to `StoredAgentConfig`, persistence mapping, `createInstance()` context config, and `AgentEditorPage` form data. All fields default to `false`/`[]` for backward compatibility.

- **Model Registry: 10 new OpenAI models** — Added GPT-5.3 (codex, chat-latest), GPT-5.2 (codex, chat-latest), GPT-5.1 (base, codex, codex-max, codex-mini, chat-latest), and GPT-5 chat-latest. OpenAI total: 12 → 22 models.

- **Model Registry: 3 new Anthropic models** — Added Claude Opus 4.6 (`claude-opus-4-6`, 128K output, adaptive thinking), Claude Sonnet 4.6 (`claude-sonnet-4-6`, 1M context beta), and Claude Opus 4 (`claude-opus-4-20250514`). Anthropic total: 7 → 10 models. Registry total: 35 → 48.

- **Model Registry: `preferred` field on `ILLMDescription`** — New optional boolean field to mark recommended models per vendor. Currently set on `gpt-5.2` (general purpose) and `gpt-5.2-codex` (coding/agentic).

- **Model Registry: Cached input pricing** — Added `cpmCached` for GPT-5.2, GPT-5, GPT-5-mini, GPT-5-nano, GPT-4.1 series, GPT-4o series, o3-mini, and o1.

- **Model Registry: Reference doc** — Created `src/domain/entities/MODEL_REGISTRY_SOURCES.md` with vendor doc URLs and update checklist.

### Changed

- **Model Registry: Fixed knowledge cutoffs** — GPT-4.1 series: 2025-04-01 → 2024-06-01. GPT-4o/4o-mini: 2024-04-01 → 2023-10-01. o3-mini/o1: 2024-10-01 → 2023-10-01.

- **Model Registry: Fixed model features** — `gpt-5.2-pro`: structuredOutput → false. `gpt-4o`/`gpt-4o-mini`: audio → false, removed audio from input/output. `o3-mini`: vision → false, removed image from input.

- **Model Registry: Anthropic deprecation notices** — Marked `claude-3-7-sonnet-20250219` as deprecated per official docs. Marked `claude-3-haiku-20240307` as deprecated (retiring April 19, 2026). Updated legacy model descriptions.

- **Model Registry: 3 new Google models** — Added `gemini-3.1-pro-preview` ($2/$12, replaces deprecated 3-pro), `gemini-3.1-flash-lite-preview` ($0.25/$1.50), and `gemini-3.1-flash-image-preview` (131K ctx, image gen up to 4K). Google total: 7 → 10. Registry total: 35 → 51.

- **Model Registry: Google pricing updates** — `gemini-3-flash-preview`: $0.15→$0.50 input, $0.6→$3.00 output. `gemini-2.5-flash`: $0.15→$0.30 input, $0.6→$2.50 output. `gemini-2.5-flash-lite`: $0.075→$0.10 input, $0.3→$0.40 output. Added cached pricing to gemini-3.1-pro, gemini-3-flash, gemini-2.5-pro, gemini-2.5-flash.

- **Model Registry: Google fixes per official docs** — Fixed context windows to exact 1,048,576 tokens. Fixed `gemini-3-pro-image-preview`: context 1M→65K, output 65K→32K, no caching. Fixed `gemini-2.5-flash-image`: context 1M→65K, output 65K→32K, reasoning→false, cutoff→June 2025. Fixed knowledge cutoffs for Gemini 3 series (2025-08→2025-01). Marked `gemini-3-pro-preview` as deprecated (shutting down March 9, 2026).

- **Model Registry: Grok fixes per official docs** — Fixed `grok-4-fast-reasoning`: added vision/image support. Fixed `grok-4-0709`: reasoning → true. Fixed `grok-3-mini`: reasoning → true. Added `cpmCached` to all 9 Grok models. Set `promptCaching: true` and `batchAPI: true` for all Grok models. Marked `grok-2-vision-1212` as legacy (not in current xAI docs).

- **Image Registry: 3 new Google Nano Banana models** — Added `gemini-3.1-flash-image-preview` (Nano Banana 2, 4K support, $0.045-$0.151/image by resolution), `gemini-3-pro-image-preview` (Nano Banana Pro, reasoning-driven design, $0.134-$0.24/image), `gemini-2.5-flash-image` (Nano Banana, fast workflows, $0.039/image). Google image models: 3 → 6.

- **Image Registry: Imagen 4 Ultra pricing fix** — `imagen-4.0-ultra-generate-001`: $0.08 → $0.06 per image per official pricing.

- **Video Registry: Google Veo pricing overhaul** — `veo-2.0-generate-001`: $0.03 → $0.35/s. `veo-3.1-fast-generate-preview`: $0.75 → $0.15/s (720p/1080p). `veo-3.1-generate-preview`: $0.75 → $0.40/s (720p/1080p). Fixed Veo 2 capabilities (no imageToVideo, 720p only). Fixed Veo 3.1 Fast capabilities (added 1080p/4K, videoExtension, frameControl).

- **TTS Registry: Google TTS pricing** — Added token-based pricing for `gemini-2.5-flash-preview-tts` ($0.50/$10.00 per 1M tokens in/out) and `gemini-2.5-pro-preview-tts` ($1.00/$20.00 per 1M tokens). Updated `TTSModelPricing` interface with `perMInputTokens`/`perMOutputTokens` fields. Updated `calculateTTSCost()` to handle both character-based (OpenAI) and token-based (Google) pricing.

- **Tool Catalog: Pinned categories** — New `pinned` config option for categories that are always loaded and cannot be unloaded by the LLM. Pinned categories are auto-loaded on plugin init, excluded from `maxLoadedCategories` limit, and skipped during compaction.

- **Tool Catalog: Dynamic instructions** — `getInstructions()` now builds instructions dynamically, listing all available categories with `[PINNED]` markers. LLM sees exactly which categories it can browse, instead of generic instructions. Core plugin tools (memory, context, etc.) are noted as always available.

### Changed

- **Tool Catalog: Separated built-in and connector scoping** — `toolCategories` now only scopes built-in categories (filesystem, web, code, etc.). Connector categories (`connector:*`) are scoped solely by `identities`, removing the previous double-filtering behavior. This is a minor behavioral change: connector categories no longer need to be listed in `toolCategories` to be visible.

- **Tool Catalog: Search results include pinned info** — `tool_catalog_search` results now include a `pinned` boolean field for each category. `getContent()` shows `[PINNED]` markers alongside `[LOADED]`.

## [0.4.5] - 2026-02-26

### Changed

- **Hosea: Migrated UnifiedToolCatalog to ToolCatalogRegistry** — Replaced Hosea's parallel tool catalog system (`UnifiedToolCatalog` + 3 provider classes) with the core `ToolCatalogRegistry`. Browser and desktop tool categories are now registered at startup via `registerHoseaTools()`. Deleted `UnifiedToolCatalog.ts`, `OneRingToolProvider.ts`, `BrowserToolProvider.ts`, `DesktopToolProvider.ts`.

- **ToolCatalogRegistry: Factory support + grouped resolution** — Extended `CatalogToolEntry` with optional fields for app-level extensions:
  - `createTool?: (ctx) => ToolFunction` — factory for runtime tool creation (e.g., browser tools needing BrowserService)
  - `source?`, `connectorName?`, `serviceType?`, `connectorServiceTypes?` — metadata fields for UI and resolution
  - `tool` field is now optional (factory-only entries supported)
  - New `resolveToolsGrouped()` method splits tools into `plain` vs `byConnector` groups
  - `resolveTools()` now accepts optional `context` for factory resolution

## [0.4.4] - 2026-02-26

### Changed

- **Tool Catalog: Hardened ToolCatalogRegistry + ToolCatalogPluginNextGen** — Major internal refactor with no breaking API changes:
  - **DRY:** Extracted `ToolRegistryEntry` type, `toDisplayName()`, and `parseConnectorCategory()` static helpers to eliminate duplication across registry and plugin
  - **Lazy ConnectorTools accessor:** Single `getConnectorToolsModule()` with false sentinel prevents retrying failed `require()` — replaces 4 separate try/catch blocks
  - **Connector logic moved to Registry:** New `discoverConnectorCategories()` and `resolveConnectorCategoryTools()` methods on `ToolCatalogRegistry` — plugin delegates instead of duplicating ~100 lines of connector discovery
  - **Bug fix:** `executeLoad()` now applies scope check uniformly to connector categories (previously skipped, allowing blocked connectors to load)
  - **Input validation:** `registerCategory()` and `registerTools()` throw on empty/whitespace category names
  - **Robust restoreState():** Validates state shape, skips non-string entries, checks `executeLoad()` error results
  - **Destroyed-state guard:** All 3 metatools return `{ error: 'Plugin destroyed' }` after `destroy()`
  - **Performance:** Connector categories discovered once at init (no more per-turn `discoverAll()` calls); tool definition token estimates cached via `WeakMap`
  - New exported types: `ConnectorCategoryInfo`, `CatalogRegistryEntry`

### Added

- **Tool Catalog: Dynamic Tool Loading/Unloading** — New `ToolCatalogRegistry` static class for registering tool categories and tools at the library level. New `ToolCatalogPluginNextGen` plugin with 3 metatools (`tool_catalog_search`, `tool_catalog_load`, `tool_catalog_unload`) that let agents dynamically discover and load only the tool categories they need at runtime. Reduces token waste when agents have 100+ available tools. Features:
  - Runtime-extensible tool category registry (library users register their own categories)
  - Agent-level category scoping via `toolCategories` config (allowlist/blocklist)
  - `ToolCatalogRegistry.resolveTools()` for resolving tool names to `ToolFunction[]` (replaces V25's parallel catalog)
  - `ToolCatalogRegistry.initializeFromRegistry()` for explicit initialization in ESM environments
  - `ToolManager.getByCategory()` convenience method for bulk category queries
  - All 3 catalog metatools added to DEFAULT_ALLOWLIST (safe by default)
  - Enable via `features: { toolCatalog: true }` on `AgentContextNextGen`
- **Routine Execution Recording** — New `RoutineExecutionRecord` types and `createExecutionRecorder()` factory for persisting routine execution history. Storage-agnostic types (`RoutineExecutionStep`, `RoutineTaskSnapshot`, `RoutineTaskResult`) replace manual hook wiring with a single factory call. `IRoutineExecutionStorage` interface for custom backends (MongoDB, PostgreSQL, etc.). Integrated into `StorageRegistry` as `routineExecutions`. Consumers wire recording with ~5 lines instead of ~140 lines of manual hooks/callbacks.
- **Routine Scheduling** — New `IScheduler` interface with `ScheduleSpec` supporting interval, one-time (timestamp), and cron schedule types. Built-in `SimpleScheduler` implementation using `setInterval`/`setTimeout` (throws clear error for cron — use a cron-capable implementation). Implements `IDisposable` for clean timer cleanup.
- **Event Trigger System** — New `EventEmitterTrigger` class for triggering routine execution from external events (webhooks, queues, custom signals). Simple typed event emitter with `on()`/`emit()`/`destroy()`. No heavy `ITriggerSource` interface — users call `emit()` from their handler.
- **Flexible Source Resolution for Routine Control Flow** — Three-layer source resolution for `map`/`fold` control flow operations. Replaces brittle `sourceKey: string` with flexible `source: ControlFlowSource` that supports:
  - **Simple key** (`source: 'items'`) — backward-compatible direct memory key lookup
  - **Task reference** (`source: { task: 'Research' }`) — resolves to `__task_output_{name}` with dep_result fallback
  - **Structured ref** (`source: { key: 'data', path: 'items' }`) — direct key with JSON path extraction
  - **Output contracts** (Layer 1) — system auto-injects storage instructions into task prompts when downstream tasks reference the current task via `source.task`, keeping user task descriptions natural language
  - **Smart coercion** (Layer 2) — algorithmic array coercion: JSON string parsing, common field extraction (`data`, `items`, `results`, etc.)
  - **LLM extraction fallback** (Layer 3) — uses `runDirect()` to extract arrays from unstructured data as a last resort
  - Template resolution extended to `source.task` and `source.key` fields
  - New exports: `TaskSourceRef`, `ControlFlowSource` types; `resolveFlowSource` function
- **Agent-Scoped Connector Availability** — Agents with `connectors: ['github', 'serper']` now only see and can execute tools produced by those connectors. New `ToolManager.registerConnectorTools(connectorName, tools)` sets `source: 'connector:<name>'` on each tool. `BaseAgent.getEnabledToolDefinitions()` filters connector tools against the agent's allowlist. Execution-time safety net in `ToolManager.execute()` blocks tools from unavailable connectors. Built-in tools (filesystem, shell, memory, etc.) are never filtered. Backward compatible: `connectors: undefined` shows all tools as before. Hosea updated to use `resolveToolsGrouped()` and `registerConnectorTools()` for proper source tracking.
- **Hosea: Routines** — Full routine/workflow support in Hosea. Routines are multi-step automated task sequences that run on a chat tab's agent instance. Includes:
  - **Routines Page** — List all routines with search, sort (name/date), and card/list view toggle. Duplicate and delete routines directly from the list.
  - **Routine Builder** — Visual editor for creating/editing routine definitions. Sections: basic info (name, description, version, author, tags), LLM instructions, task list with accordion editor (name, description, dependencies as clickable badges, suggested tools, expected output, max attempts, optional validation with completion criteria and min score), and settings (concurrency mode, dynamic tasks toggle, required tools/plugins).
  - **Routines Sidebar Panel** — Third tab in the chat sidebar. Three views: routine list (compact, clickable), routine detail (full info with Execute button), and execution monitor (live progress bar, task status cards with icons, timestamped step log, cancel button).
  - **Real-time Execution** — Routine execution state flows via StreamChunk events (`routine:started`, `routine:task_started`, `routine:task_completed`, `routine:task_failed`, `routine:step`, `routine:completed`, `routine:failed`). No persistence — execution state is in-memory only, derived from events.
  - **Chat Input Guard** — Chat input and send button are disabled while a routine is executing on the tab's agent. Placeholder text changes to "Agent is executing a routine...".
  - **Navigation** — Routines added to main sidebar under "Main" section. New `routines` and `routine-builder` page IDs.
  - Uses core library types directly (`RoutineDefinition`, `RoutineDefinitionInput`, `TaskInput`, etc.) — no duplicate `*ForUI` types.

## [0.4.3] - 2026-02-25

### Fixed

- **Routine Runner: Iteration limiter hook leak** — The per-task `pause:check` hook was only unregistered on the happy path. If a task failed via control flow error, max-attempts break, or fail-fast, the hook leaked and accumulated on reused agents. Now wrapped in `try-finally` for guaranteed cleanup.
- **Routine Runner: Fold accumulator treats empty string as valid** — Empty string `''` was incorrectly treated as "no output", falling back to ICM. Now only `null` (meaning no completed task) triggers ICM fallback. Any other value (including `''`, `0`, `false`) is a valid accumulator.

### Changed

- **Routine Runner: Permanent errors skip retry** — New `isTransientError()` classification. Auth errors, context length errors, config errors, and model-not-found errors now immediately fail the task instead of retrying uselessly. Unknown errors still retry (safer default).
- **Routine Runner: DRY refactoring** — Extracted shared `getPlugins()` helper (exported from `routineControlFlow.ts`), unified `cleanupMemoryKeys()` helper with configurable prefix lists, and `ROUTINE_KEYS` constants object replacing ~25 magic string literals across both files.
- **Routine Runner: Cleanup errors now logged** — Previously silent `catch {}` blocks in the finally cleanup now log at debug level for observability. `agent.destroy()` failures also logged.

### Added

- **Control Flow: Per-iteration timeout** — New optional `iterationTimeoutMs` field on `TaskMapFlow`, `TaskFoldFlow`, and `TaskUntilFlow`. When set, each sub-execution is wrapped with `Promise.race` timeout, preventing infinite hangs in control flow loops.
- **`ROUTINE_KEYS` constant** — Exported from core library. Contains all well-known ICM/WM key names used by the routine framework (`__routine_plan`, `__map_item`, `__fold_accumulator`, etc.).

## [0.4.2] - 2026-02-22

### Added

- **Shared Context Display Panel (`@everworker/react-ui`)** — Extracted `ContextDisplayPanel` from both v25 (750 lines) and Hosea (202 lines) into a shared `packages/react-ui/src/context-display/` module. Includes all v25 features (collapse/expand, maximize, drag-and-drop reordering with localStorage persistence, inline markdown editing, PDF/DOCX export via callbacks, highlight/scroll on change detection) plus Hosea's pin/unpin feature. App-specific logic delegated via callback props (`onSaveEntry`, `onExport`, `onPinToggle`). Feature toggles (`enableDragAndDrop`, `enableEditing`, `enableExport`) let each app opt in/out. Extracted hooks: `useDynamicUIChangeDetection` (change detection), `useOrderPersistence` (drag-and-drop order). BEM CSS with `cdp-` prefix and `--rui-*` / `--cdp-*` CSS custom properties for theming. Both Hosea and v25 migrated to thin wrappers (~45 and ~80 lines respectively). New CSS export: `@everworker/react-ui/styles/context-display`.
- **Shared Chat UI Components (`@everworker/react-ui`)** — Consolidated all reusable chat UI components into the shared `@everworker/react-ui` package. New `markdown/` module: `MarkdownRenderer` (merged from Hosea streaming context + v25 advanced math preprocessing), `CodeBlock` (streaming-aware with lazy-loaded special renderers), `MermaidDiagram`, `VegaChart`, `MarkmapRenderer` (all with optional peer deps via dynamic import), `RenderErrorBoundary`. New `chat/` module: `MessageList` (with smart auto-scroll, thinking support), `StreamingText` (animated cursor), `ToolCallCard` (category colors + expandable details), `InlineToolCall`, `ExecutionProgress` (cycling status messages + tool accordion), `ChatControls` (pause/resume/cancel), `ExportMessage` (injectable export handler), `ThinkingBlock` (NEW — collapsible thinking/reasoning display). Framework-agnostic CSS with `--rui-*` custom properties for theming. New CSS exports: `@everworker/react-ui/styles/markdown`, `@everworker/react-ui/styles/chat`, `@everworker/react-ui/styles/thinking`. Shared types: `IChatMessage`, `IToolCallInfo` with full TypeScript support.
- **Generic Thinking/Reasoning Support** — Vendor-agnostic thinking/reasoning support across all three providers (Anthropic, OpenAI, Google). New `thinking` option on `TextGenerateOptions`: `{ enabled: boolean, budgetTokens?: number, effort?: 'low'|'medium'|'high' }`. Adds `ThinkingContent` type with vendor-aware persistence (`persistInHistory: true` for Anthropic, `false` for OpenAI/Google). Anthropic thinking blocks round-trip with signature preservation. OpenAI reasoning summaries extracted as `ThinkingContent`. Google thought parts detected and converted. New streaming events: `REASONING_DELTA` and `REASONING_DONE` with type guards `isReasoningDelta()` / `isReasoningDone()`. `StreamState` gains reasoning buffers. `StreamHelpers` adds `thinkingOnly()`, `textAndThinking()`, `accumulateThinking()`. `AgentContextNextGen` exposes `lastThinking` property (always available regardless of persistence). Agent-level: `thinking` config option wires through to all providers. `LLMResponse` gains `thinking?: string` convenience field (parallel to `output_text`). OpenAI `reasoning_tokens` now captured in `TokenUsage.output_tokens_details`. Shared `validateThinkingConfig()` validates budget/effort before sending to providers.
- **Snapshot API (`getSnapshot()` / `getViewContext()`)** — New methods on `AgentContextNextGen` and `BaseAgent` that return fully serializable, canonical representations of context state. `getSnapshot()` returns `IContextSnapshot` with budget, plugins (auto-discovered), tools, and conversation stats. `getViewContext()` returns `IViewContextData` with a human-readable breakdown of the prepared context (for "View Full Context" UIs). Plugin data is an array (not hardcoded fields) — new/custom plugins appear automatically without code changes. New types: `IContextSnapshot`, `IPluginSnapshot`, `IToolSnapshot`, `IViewContextData`, `IViewContextComponent`. New utility: `formatPluginDisplayName()`.
- **Shared React UI package (`@everworker/react-ui`)** — New `packages/react-ui/` package with reusable "Look Inside" components for displaying agent context internals. Includes: `LookInsidePanel` (main container with auto-discovery of plugin sections), `ViewContextContent` (prepared context breakdown), `CollapsibleSection`, and individual sections (ContextWindow, TokenBreakdown, SystemPrompt, Tools). Plugin renderers for WorkingMemory, InContextMemory, PersistentInstructions, and UserInfo with a registry for custom renderers (`registerPluginRenderer()`). No icon/CSS framework dependency — uses semantic `look-inside-*` CSS classes with CSS custom properties for theming.
- **Hosea: LLM Providers page improvements** — (1) "Update Key" button now works: opens edit modal to change API key or base URL for local connectors. (2) Ollama vendor added: no API key required, optional base URL field (defaults to `http://localhost:11434/v1`). (3) "Fetch Models" button in both Add and Edit modals: queries the provider's API via `listModels()` to discover available models, displayed as badges. (4) Models shown on all connector cards (not just Everworker connectors). (5) `addConnector()` now registers with the Connector library immediately (fixes bug where newly added connectors weren't usable until restart).
- **Hosea: Agent editor model dropdown shows live models** — The model selector in the Agent Editor now fetches live models from the provider's API via `listModels()`. Models are shown in two groups: "Known Models" (from the static registry, with context window info) and "Available from Provider" (live models not in the registry). This is essential for Ollama and other providers where the available models depend on what's installed locally.
- **`listModels()` on all LLM text providers** — New `listModels(): Promise<string[]>` method on `ITextProvider` (now required), implemented on OpenAI, Anthropic, Google, Vertex AI, and Generic OpenAI providers. Returns sorted model ID strings from the provider's API. `GenericOpenAIProvider` wraps in try/catch for safety (some OpenAI-compatible APIs may not support `/v1/models`). `BaseTextProvider` default returns `[]`. Also exposed as `agent.listModels()` on all agents via `BaseAgent`.
- **Ollama Integration Tests** — New dedicated Ollama integration test file (`tests/integration/text/Ollama.integration.test.ts`) covering basic text generation, streaming, tool calling (single, sequential, counter), multi-turn conversation, and `runDirect`. Tests auto-detect Ollama availability and model via HTTP ping to `/api/tags`. Ollama also added to `AllModels` and `ProviderConverters` integration test suites including cross-provider consistency checks.

### Fixed

- **Thinking: Vendor detection** — Streaming thinking persistence now uses `connector.vendor` instead of fragile response ID prefix parsing. Previously, `responseId.startsWith('msg_')` was used to detect Anthropic, which could collide with OpenAI message IDs.
- **Thinking: `StreamHelpers.collectResponse()` now includes thinking** — `reconstructLLMResponse()` was silently dropping all accumulated reasoning content. Now correctly includes `ThinkingContent` in the output and populates the `thinking` convenience field.
- **Thinking: `lastThinking` reset** — `lastThinking` is now reset to `null` at the start of each `prepare()` call, preventing stale thinking data from leaking across turns in error paths.
- **Thinking: Anthropic signature round-trip safety** — Streaming thinking blocks (which lack Anthropic's opaque signature) are now skipped when converting back to Anthropic format, preventing API errors. Non-streaming responses correctly preserve and round-trip signatures.
- **Thinking: OpenAI duplicate content removed** — OpenAI reasoning items no longer produce both a legacy `reasoning` item and a `ThinkingContent` item. Only the unified `ThinkingContent` is emitted.
- **Snapshot serialization** — `getSnapshot()` now ensures plugin `contents` are always JSON-serializable. `Map` values (returned by InContextMemory, PersistentInstructions, UserInfo plugins) are converted to arrays. `Promise` values (returned by WorkingMemory) are awaited. This fixes data loss when snapshots are transmitted over JSON-based transports (e.g., Meteor DDP).
- **AlgorithmicCompactionStrategy graceful degradation** — The `algorithmic` compaction strategy (the default) no longer throws when `workingMemory: false`. Previously, creating an agent with `features: { workingMemory: false }` would crash because the strategy requires the `working_memory` plugin. Now the strategy degrades gracefully: when working memory is unavailable, it skips moving large tool results to memory and only applies tool pair limiting + rolling window compaction. The `validateStrategyDependencies` check in `AgentContextNextGen` now logs a warning instead of throwing.

### Changed

- **Hosea: Migrated chat rendering to shared `@everworker/react-ui`** — Replaced ~300 lines of inline message rendering (renderUserMessage/renderAssistantMessage/renderSystemMessage/renderMessage, ToolCallDisplay imports) with shared `MessageList` and `ExecutionProgress` components. `Message` and `ToolCallInfo` types now re-exported from `@everworker/react-ui` (`IChatMessage`, `IToolCallInfo`). Added `streamingThinking` support to `TabState` and chunk handling. Added thinking stream events (`thinking`, `thinking_done`) to `StreamChunk` union type and `AgentService` stream handler (maps `response.reasoning.delta`/`response.reasoning.done`). New CSS imports: `@everworker/react-ui/styles/markdown`, `@everworker/react-ui/styles/chat`, `@everworker/react-ui/styles/thinking`. ContextDisplayPanel now uses shared `MarkdownRenderer`.
- **v25: Migrated chat components to shared `@everworker/react-ui`** — `MessageList` replaced with thin adapter wrapper that converts v25 `IChatMessage` (with `_id`, `timestamp: Date`) to shared format via `adaptMessage()`. `ToolCallCard` replaced with adapter that maps v25 field names (`toolCallId`→`id`, `toolName`→`name`, `arguments`→`args`, `completed`→`complete`). `MarkdownRenderer` replaced with re-export from shared lib (1285 lines → 11 lines). `StreamingText` updated to use shared `MarkdownRenderer`. New adapter layer: `ui/adapters/chatAdapters.ts` with `adaptToolCall()` and `adaptMessage()` functions. Added thinking/reasoning support: new `reasoning.delta`/`reasoning.done` event types in V25ChatEventType, new payload types `IV25ReasoningDeltaPayload`/`IV25ReasoningDonePayload`, `AgentEventBridge` handles reasoning stream events, `useAgentChat` tracks `streamingThinking` state, `IAgentChatState` includes `streamingThinking`, `AgentChatPage` passes thinking through to `MessageList`.
- **`@everworker/react-ui`: Fixed component issues** — Removed unused `react-bootstrap` peer dependency. Typed `CodeComponent` props properly (was `any`). Typed VegaLite dynamic component (was `React.ComponentType<any>`).
- **Hosea: Migrated Look Inside panel to shared `@everworker/react-ui`** — Replaced ~2,300 lines of monolithic rendering code (InternalsContent + InternalsPanel + manual data extraction in AgentService) with thin wrappers around the shared `LookInsidePanel` and `ViewContextContent` components. Backend now uses `agent.getSnapshot()` and `agent.getViewContext()` instead of ~490 lines of manual plugin-level data extraction. Added `@everworker/react-ui` as a dependency.
- **v25: Migrated Look Inside panel to shared `@everworker/react-ui`** — Replaced ~1,100 lines (LookInsidePanel + ViewContextModal + internalsTypes) with thin wrappers. Backend uses `agent.getSnapshot()` and `agent.getViewContext()` instead of ~230 lines of manual extraction. Deleted `internalsTypes.ts` (types now from `@everworker/oneringai`).
- **Shared `@everworker/react-ui`: Added memory entry click support** — `WorkingMemoryRenderer` now supports optional `onEntryClick`, `entryValues`, `loadingEntryKey` props for lazy value loading (used by Hosea's IPC-based memory value fetching). Props flow through `LookInsidePanel` via `onMemoryEntryClick`, `memoryEntryValues`, `loadingMemoryKey`.
- **GenericOpenAIProvider** — `validateApiKey()` now always returns valid for generic providers (Ollama, local models, etc.) that don't require authentication, preventing validation warnings for `auth: { type: 'none' }` connectors.
- **NoneConnectorAuth documentation** — Updated comments to clarify that `auth: { type: 'none' }` is for local services like Ollama, not just testing/mock providers.

## [0.4.0] - 2026-02-20

### Added

- **Microsoft Graph Connector Tools** — 6 new ConnectorTools for Microsoft Graph API, auto-registered for connectors with `serviceType: 'microsoft'` or `baseURL` matching `graph.microsoft.com`. Tools: `create_draft_email` (new draft or reply draft), `send_email` (send or reply), `create_meeting` (calendar event with optional Teams link), `edit_meeting` (partial update), `get_meeting_transcript` (Teams transcript as plain text), `find_meeting_slots` (availability-based scheduling). Supports both delegated (`/me`) and application (`/users/{id}`) permission modes via `getUserPathPrefix()` helper. All tools follow the ConnectorTools pattern — use `ConnectorTools.for('my-microsoft-connector')` to get all tools.
- **RoutineDefinition Storage** — New `IRoutineDefinitionStorage` interface and `FileRoutineDefinitionStorage` implementation for persisting routine definitions to disk. Per-user isolation via optional `userId` (defaults to `'default'`). Stored at `~/.oneringai/users/<userId>/routines/<id>.json` with index file for fast filtering. Supports tag/search filtering and pagination. Integrated into `StorageRegistry` as `routineDefinitions` factory.
- **Routine Runner** — New `executeRoutine()` function (`src/core/routineRunner.ts`) that executes a `RoutineDefinition` end-to-end. Creates an Agent with working memory + in-context memory, runs tasks in dependency order, validates completion via LLM self-reflection, and clears conversation between tasks while preserving memory plugins as the data bridge. Supports configurable prompts (system, task, validation), retry with max attempts, `fail-fast` / `continue` failure modes, and `onTaskComplete` / `onTaskFailed` callbacks. Exported as `executeRoutine`, `ExecuteRoutineOptions`, and `ValidationContext`.
- **Routine Validation Context** — Task validation now receives a full `ValidationContext` (not just the agent's text output). The validator sees: the agent's response text, the in-context memory state, the working memory index, and a formatted log of all tool calls made during the task. This allows the LLM validator to verify what actually happened (e.g., "key findings stored in memory") rather than relying on the agent's claims.
- **UserInfo Plugin** — New `UserInfoPluginNextGen` for storing user-specific preferences and context. Data is user-scoped (not agent-scoped), allowing different agents to share the same user data. Storage path: `~/.oneringai/users/<userId>/user_info.json` (defaults to `~/.oneringai/users/default/user_info.json` when no userId). Enable via `features: { userInfo: true }`. Includes 4 tools: `user_info_set`, `user_info_get`, `user_info_remove`, `user_info_clear` (all allowlisted by default). **userId is optional** — tools work without it, defaulting to the `'default'` user. User info is automatically injected into the LLM context as markdown — no need to call `user_info_get` every turn.
- **IUserInfoStorage interface** — Storage abstraction for user information with file-based implementation (`FileUserInfoStorage`). UserId is optional (`string | undefined`), defaults to `'default'`. Supports multi-user scenarios via `StorageRegistry` pattern with optional `StorageContext`.
- **userInfo feature flag** — Added to `ContextFeatures` interface. Default: `false`.
- **userInfo storage factory** — Added to `StorageConfig` interface as context-aware factory: `userInfo: (context?: StorageContext) => IUserInfoStorage`.

- **Routine Context Flow** — Routine tasks now automatically receive plan overview and dependency results before execution. Plan overview (all tasks with statuses) is injected into in-context memory as `__routine_plan`. Dependency results are automatically routed: small results (< 5000 tokens) go directly into in-context memory, large results go to working memory with descriptive labels. Tasks with dependencies get a prompt note about available results. All routine-managed keys (`__routine_*`, `__dep_result_*`) are cleaned up after execution.

### Changed

- **InContextMemory default enabled** — `DEFAULT_FEATURES.inContextMemory` changed from `false` to `true`. All agents now have in-context memory available by default.
- **InContextMemory default token limit** — `maxTotalTokens` increased from 4000 to 40000 to accommodate routine plan overviews and dependency results.
- **Custom Tools Storage - Optional Per-User Isolation** — Custom tools storage now supports optional per-user isolation for multi-tenant scenarios. `ICustomToolStorage` interface updated to accept optional `userId` parameter in all methods: `save(userId?, definition)`, `load(userId?, name)`, `delete(userId?, name)`, `exists(userId?, name)`, `list(userId?, options)`, `updateMetadata(userId?, name, metadata)`, `getPath(userId?)`. When `userId` is not provided, defaults to `'default'` user. File storage path changed from `~/.oneringai/custom-tools/` to `~/.oneringai/users/<userId>/custom-tools/` (defaults to `~/.oneringai/users/default/custom-tools/`). **Backwards compatible** - existing code works without changes. Opt-in to multi-user isolation by providing `userId: 'user-id'` when creating agents.

### Migration Guide: Custom Tools Storage

**No migration required for existing applications!** Custom tools storage is fully backwards compatible.

**For Custom Storage Implementers:**

If you have a custom `ICustomToolStorage` implementation, update methods to accept optional `userId`:

```typescript
// Before (0.3.1 and earlier)
class MyCustomToolStorage implements ICustomToolStorage {
  async save(definition: CustomToolDefinition): Promise<void> {
    await this.db.insert(definition);
  }
  async load(name: string): Promise<CustomToolDefinition | null> {
    return this.db.findOne({ name });
  }
}

// After (0.4.0+) - userId is optional
class MyCustomToolStorage implements ICustomToolStorage {
  async save(userId: string | undefined, definition: CustomToolDefinition): Promise<void> {
    const user = userId || 'default';
    await this.db.insert({ userId: user, ...definition });
  }
  async load(userId: string | undefined, name: string): Promise<CustomToolDefinition | null> {
    const user = userId || 'default';
    return this.db.findOne({ userId: user, name });
  }
}
```

**For Existing Custom Tools:**

Custom tools at `~/.oneringai/custom-tools/` will be moved automatically on first access to `~/.oneringai/users/default/custom-tools/`. No manual migration needed.

**For Multi-Tenant Applications (Optional):**

To enable per-user isolation, provide `userId` when creating agents:

```typescript
// Single-user app (no changes needed)
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  // No userId - defaults to 'default' user
});

// Multi-tenant app (opt-in)
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  userId: currentUser.id,  // Each user gets isolated custom tools
});

// OR set globally
StorageRegistry.setContext({ userId: currentUser.id });
```

## [0.3.1] - 2026-02-18

### Fixed

- **ConnectorTools invalid tool names** — Connector names with spaces or special characters (e.g., "Microsoft Graph API") now produce valid tool names (`Microsoft_Graph_API_api`) instead of invalid ones that break LLM provider APIs. Added shared `sanitizeToolName()` utility and deduplicated the existing MCP adapter sanitizer.

### Added

- **`sanitizeToolName()`** — Exported utility that sanitizes arbitrary strings to valid tool names matching `^[a-zA-Z0-9_-]+$`.

## [0.3.0] - 2026-02-18

### Fixed

- **Registry-driven model capabilities** — All 5 text providers (OpenAI, Anthropic, Google, Vertex AI, Generic) now resolve model capabilities from the centralized `MODEL_REGISTRY` instead of hardcoded string matching. Models like GPT-5.2 (400K context) now correctly report their limits instead of falling through to provider defaults (e.g., 4096 tokens). Error messages for context length exceeded now report the actual model's limit.

### Added

- **`resolveModelCapabilities()`** — New helper that maps any model identifier to `ModelCapabilities` using the centralized registry, with vendor-specific fallbacks for unregistered models.
- **`resolveMaxContextTokens()`** — New helper for accurate context limit resolution in error messages.
- **StorageRegistry** — Centralized storage backend registry (`StorageRegistry` class in `src/core/StorageRegistry.ts`). Provides a single `configure()` call to swap all storage backends (custom tools, media, sessions, persistent instructions, working memory, OAuth tokens, etc.) at init time. All subsystems resolve storage lazily at execution time via `StorageRegistry.resolve()`, with file-based defaults as fallback. No breaking changes — existing `setMediaStorage()`, `Connector.setDefaultStorage()`, and explicit constructor params continue to work.
- **StorageContext** — Multi-tenant support for `StorageRegistry`. All factory functions (`customTools`, `sessions`, `persistentInstructions`, `workingMemory`) now accept an optional opaque `StorageContext` (same pattern as `ConnectorAccessContext`). Set globally via `StorageRegistry.setContext({ userId, tenantId })` or auto-derived from `AgentContextNextGen.userId`. Enables storage partitioning by user, tenant, or any custom dimension.
- **`customTools` is now a context-aware factory** — `StorageConfig.customTools` changed from `ICustomToolStorage` to `(context?: StorageContext) => ICustomToolStorage`. Custom tool meta-tools (`custom_tool_save/list/load/delete`) receive `ToolContext` at execution time and forward `userId` to the factory for per-user storage isolation. All 6 meta-tools remain in the built-in tool registry.
- **`Agent.saveDefinition()` and `Agent.fromStorage()` now resolve from StorageRegistry** — The `storage` parameter is now optional. If omitted, resolves from `StorageRegistry.get('agentDefinitions')`.
- **`ConnectorConfigStore.create()` factory** — New static factory that resolves `IConnectorConfigStorage` from `StorageRegistry.get('connectorConfig')` when no explicit storage is provided.
- **xAI Grok models** — 9 Grok models added to the model registry: Grok 4.1 (fast reasoning/non-reasoning, 2M context), Grok 4 (fast reasoning/non-reasoning, flagship 0709), Grok Code Fast 1, Grok 3/3-mini, Grok 2 Vision.

### Changed

- **SDK Upgrades** — Updated all LLM vendor SDKs to latest versions:
  - `@anthropic-ai/sdk` 0.30.1 → 0.76.0 (eliminates 6 deprecated transitive dependencies: node-fetch, node-domexception, formdata-node, abort-controller, agentkeepalive, web-streams-polyfill)
  - `openai` 6.16.0 → 6.22.0
  - `@google/genai` 1.34.0 → 1.41.0
  - `@modelcontextprotocol/sdk` 1.25.3 → 1.26.0 (security fix)
- **Anthropic Provider** — Removed type assertion hacks for URL-based images (now officially supported in SDK)

## [0.2.3] - 2026-02-17

### Added

- **Custom Tool Generation System** *(Highlight)* — A complete meta-tool system that enables any agent to **create, test, iterate, and persist reusable custom tools at runtime**. 6 new tools in the `custom-tools` category:
  - `custom_tool_draft` — Validates name, schema, and code syntax. Dynamic description shows full sandbox API + all registered connectors
  - `custom_tool_test` — Executes code in the VM sandbox with test input. Dynamic description with sandbox API + connector list
  - `custom_tool_save` — Persists validated tool to `~/.oneringai/custom-tools/` with tags, category, and connector metadata
  - `custom_tool_list` — Searches saved tools by name, description, tags, or category with pagination
  - `custom_tool_load` — Retrieves full definition including code for inspection or modification
  - `custom_tool_delete` — Removes a tool from storage
  - `hydrateCustomTool()` — Converts a saved `CustomToolDefinition` into a live `ToolFunction` ready for `ToolManager.register()`
  - `createCustomToolMetaTools()` — Bundle factory that creates all 6 tools with shared storage
  - All 6 tools are auto-registered in the tool registry and visible in Hosea's tool catalog
- **Custom Tool Storage** — `ICustomToolStorage` domain interface with `FileCustomToolStorage` implementation. Supports CRUD, search (case-insensitive substring on name + description), tag/category filtering, and pagination. Atomic writes with `.tmp` + rename pattern and index-based listing. Pluggable — implement `ICustomToolStorage` for MongoDB, S3, or any backend.
- **ToolManager metadata fields** — `tags`, `category`, and `source` fields on `ToolOptions`, `ToolRegistration`, and `SerializedToolState`. Enables tracking tool provenance (`built-in`, `connector`, `custom`, `mcp`) and categorization. Persisted through `getState()`/`loadState()`.
- **Exported `executeInVM`** — The VM sandbox executor from `executeJavaScript.ts` is now a public export, enabling reuse by custom tool meta-tools and external code.
- **OAuth Scope Selector** — New `ScopeSelector` component replaces the plain-text scope input field with a checkbox-based selector. Shows template-defined scopes with human-readable descriptions, all pre-checked by default. Users can toggle scopes on/off and add custom scopes. Falls back to plain text input when no template scopes are available.
- **Scope descriptions for vendor templates** — Added `scopeDescriptions` field to `AuthTemplate` type. Enriched 15+ vendor templates with comprehensive scope lists and descriptions: Microsoft (21 Graph scopes), Google (9 scopes), GitHub (9 scopes), Slack (10 scopes), Discord (7 scopes), HubSpot (8 scopes), Atlassian/Jira/Confluence/Bitbucket (expanded), Salesforce (6 scopes), Shopify (10 scopes), Box (4 scopes), PagerDuty (2 scopes), Sentry (5 scopes), Dropbox (7 scopes), GitLab, Zendesk, Trello.
- **QuickBooks vendor template** — OAuth 2.0 authorization_code flow template for QuickBooks Online API (Intuit). Includes sandbox support and company/realm ID notes.
- **Ramp vendor template** — Dual OAuth flow template for Ramp financial API: client_credentials (app-level access) and authorization_code (user-level access).

### Fixed

- **OAuth public client fallback** — AuthCodePKCE flow now auto-retries token exchange and refresh without `client_secret` when the provider rejects it for public clients (e.g., Microsoft/Entra ID error AADSTS700025). Prevents failures when a `clientSecret` is configured but the app registration is set to "public client".
- **Documentation cleanup** — Fixed multiple outdated sections in README.md and USER_GUIDE.md:
  - Replaced non-existent `webSearch`/`webScrape` standalone imports with correct `ConnectorTools.for()` pattern in README
  - Added missing scrape providers (Jina Reader, Firecrawl, ScrapingBee) to README
  - Fixed Grok provider capabilities (now shows Image ✅ and Video ✅)
  - Removed non-existent "Tool Result Eviction" section from USER_GUIDE (feature doesn't exist in codebase)
  - Removed non-existent `IdempotencyCache` from Direct LLM comparison table
  - Fixed Feature-Aware APIs section referencing old AgentContext properties (`ctx.cache`, `ctx.permissions`, `requireMemory()`, etc.) to match actual AgentContextNextGen API
  - Fixed `setupInContextMemory()` references to use correct `ctx.getPlugin()` API
  - Fixed Web Tools description to correctly note web_search/web_scrape are connector-dependent

## [0.2.1] - 2026-02-11

### Added

- **Desktop Automation Tools** — 11 new `desktop_*` tools for OS-level desktop automation, enabling "computer use" agent loops (screenshot → vision model → tool calls → repeat). Tools: `desktop_screenshot`, `desktop_mouse_move`, `desktop_mouse_click`, `desktop_mouse_drag`, `desktop_mouse_scroll`, `desktop_get_cursor`, `desktop_keyboard_type`, `desktop_keyboard_key`, `desktop_get_screen_size`, `desktop_window_list`, `desktop_window_focus`. All coordinates use physical pixel space (screenshot space); the driver handles Retina/HiDPI scaling internally. Uses `@nut-tree-fork/nut-js` as an optional peer dependency. Convenience bundle: `tools.desktopTools`.

- **`__images` convention for multimodal tool results** — Tool results containing an `__images` array (e.g., from `desktop_screenshot`) are automatically converted to native multimodal content by provider converters: Anthropic (image blocks in tool_result), OpenAI (follow-up user message with input_image), Google (inlineData parts). Images are separated from text content at the context layer (`addToolResults()`), stored on a dedicated `__images` field on `ToolResultContent`, and counted as image tokens (~85-2000 depending on dimensions) rather than text tokens. This prevents large screenshots from blowing the context budget or being rejected as binary.

- **Hosea: DesktopToolProvider** — New tool provider for Hosea that exposes all desktop automation tools in the unified tool catalog under the "Desktop Automation" category.

- **Document Reader** — Universal file-to-LLM-content converter. New `DocumentReader` class reads arbitrary file formats (Office, PDF, spreadsheets, HTML, text, images) from any source (file path, URL, Buffer, Blob) and produces `DocumentPiece[]` (markdown text + base64 images) with metadata. Pluggable architecture with 6 format handlers (Office via `officeparser`, Excel via `exceljs`, PDF via `unpdf`, HTML, text, images) and a configurable transformer pipeline (header, table formatting, truncation). All heavy dependencies are lazy-loaded.

- **`read_file` auto-detects document formats** — The `read_file` tool now automatically converts binary document formats (PDF, DOCX, XLSX, PPTX, ODT, ODP, ODS, RTF, PNG, JPG, GIF, WEBP) to markdown text. No schema change — binary documents are returned as markdown in the existing `content` field. Agents can now `read_file({ file_path: "/path/to/report.pdf" })` and it just works.

- **`web_fetch` auto-detects document downloads** — The `web_fetch` tool now detects document Content-Types (application/pdf, Office MIME types) and URL extensions, automatically converting downloaded documents to markdown. Returns `contentType: 'document'` with optional `documentMetadata`.

- **`readDocumentAsContent()` bridge** — New utility function in `src/utils/documentContentBridge.ts` converts `DocumentResult` → `Content[]` for direct LLM input. Includes `documentToContent()` for conversion and `readDocumentAsContent()` as a one-call convenience. Supports image filtering, detail level, and adjacent text merging.

- **Image filtering** — Configurable image filtering removes small/junk images (logos, icons, backgrounds) from extracted documents. Filter by `minWidth`, `minHeight`, `minSizeBytes`, `maxImages`, and `excludePatterns`. Applied both at extraction time and at content conversion time.

- **New error classes** — `DocumentReadError` and `UnsupportedFormatError` in `src/domain/errors/AIErrors.ts`.

- **New constants** — `DOCUMENT_DEFAULTS` in `src/core/constants.ts` with all configurable defaults (max tokens, image filters, Excel limits, etc.).

### Changed

- **Hosea: Non-blocking startup** — The Hosea app window now appears immediately (~1-2 seconds) instead of waiting ~20 seconds for all connectors, tools, and agents to load. Heavy initialization (connector loading, tool discovery, EW profile sync, agent loading) now runs in the background after the window is visible. A "Starting HOSEA..." spinner shows while loading completes. IPC handlers that require full initialization automatically wait via `readyHandler` wrapper. Added `AgentService.createFast()` factory method and `isReady`/`whenReady()` readiness tracking API. Renderer listens for `service:ready` event before running app initialization logic.

- **`excludeExtensions` updated** — Removed `.pdf`, `.docx`, `.xlsx`, `.pptx` from the default filesystem tool exclusion list since DocumentReader now handles these formats.

- **Image token estimation** — `estimateItemTokens()` now uses `estimateImageTokens()` (tile-based model matching OpenAI pricing) instead of a hardcoded 200-token flat estimate. `ITokenEstimator` interface extended with optional `estimateImageTokens(width?, height?, detail?)` method. Both `simpleTokenEstimator` and `ApproximateTokenEstimator` implement it. `INPUT_IMAGE_URL` respects `detail` level. `TOOL_RESULT` with `__images` counted as image tokens (~1000 default) rather than text tokens on the base64 string.

### Fixed

- **`web_scrape` swallowing real API errors** — When both native fetch and external API (e.g., ZenRows) failed, the tool returned a generic "All scraping methods failed. Site may have bot protection." message, hiding the actual error details (e.g., `AUTH004: Usage exceeded`, `HTTP 402`, quota limits). Now propagates specific errors from each attempted method: `"All scraping methods failed. native: <error> | api(zenrows): ZenRows API error (402): ..."`.

- **Screenshots rejected as "binary content too large"** — Tool results with `__images` (e.g., desktop screenshots) were being counted as text tokens (~300K tokens for a 1MB base64 string), triggering the oversized input handler which replaced the entire result with a rejection message. The model never saw the image. Fixed by: (1) separating `__images` from the text content in `addToolResults()`, (2) counting images using `estimateImageTokens()` instead of text estimation, (3) preserving `__images` through emergency truncation. All three provider converters (Anthropic, OpenAI, Google) updated to read `__images` from the Content object first (with JSON-parsing fallback for backward compatibility).

- **Desktop mouse operations** — `mouse.setPosition()` in `@nut-tree-fork/nut-js` silently no-ops (reports success but doesn't move the cursor). All mouse operations now use `mouse.move(straightTo(...))` with `mouseSpeed=10000` for near-instant movement (22-49ms, ±1px precision). Mouse speed and animation delays disabled on driver initialization. `desktop_mouse_move` and `desktop_mouse_click` now return the **actual** cursor position after the operation for verification. `desktop_screenshot` description updated to warn about region coordinate offsets and now returns `regionOffsetX`/`regionOffsetY` in the result.

- **`desktop_window_focus` not working** — `focusWindow()` was matching windows by `win.processId` which doesn't exist on nut-tree Window objects (always `undefined`). Fixed to use the actual `windowHandle` property — the unique OS window identifier. `getWindowList()` now returns `windowHandle` as the `id` and caches Window objects for efficient `focusWindow()` lookup.

## [0.2.0] - 2026-02-09

**Multi-User Support** — This release introduces uniform multi-user support across the entire framework. Set `userId` once on an agent and it automatically flows to all tool executions, connector API calls (OAuth tokens), session metadata, and dynamic tool descriptions. Combined with the new `connectors` allowlist and scoped connector registry on `ToolContext`, this provides a complete foundation for building multi-user and multi-tenant AI agent systems.

### Added

- **`userId` auto-threading through Agent → Context → ToolContext** — Set `userId` once at agent creation (`Agent.create({ userId: 'user-123' })`) or at runtime (`agent.userId = 'user-456'`) and it automatically flows to all tool executions via `ToolContext.userId`. Also persisted in session metadata on save. No breaking changes — `userId` is optional everywhere.

- **`connectors` allowlist on Agent/Context** — Restrict an agent to a subset of registered connectors via `Agent.create({ connectors: ['github', 'slack'] })`. Only listed connectors appear in tool descriptions and sandbox execution. Combines with userId scoping: allowlist is applied on top of the access-policy-filtered view. Available as `agent.connectors` getter/setter at runtime. `ToolContext.connectorRegistry` now provides the resolved registry to all tools.

- **`@everworker/oneringai/shared` Subpath Export** — New lightweight subpath export containing only pure data constants and types (Vendor, MODEL_REGISTRY, SERVICE_DEFINITIONS) with zero Node.js dependencies. Safe for Cloudflare Workers, Deno, and browser environments.

### Changed

- **`execute_javascript` tool: userId-scoped connectors, improved description, configurable timeout** — The tool now auto-injects `userId` from ToolContext into all `authenticatedFetch` calls. Connector listing (both in description and sandbox) is scoped to the current user via the global access policy when set. `descriptionFactory` now receives `ToolContext` so descriptions always reflect the connectors visible to the current user. The tool description is significantly improved with better usage guidance, more examples, and shows service type/vendor for each connector. Sandbox globals expanded (URL, URLSearchParams, RegExp, Map, Set, TextEncoder, TextDecoder). Factory accepts `maxTimeout` and `defaultTimeout` options via `createExecuteJavaScriptTool({ maxTimeout: 60000 })`.

- **Consistent userId handling across all tools** — All tools now read `userId` from `ToolContext` at execution time (auto-populated by `Agent.create({ userId })`). ConnectorTools generic API tool, all 7 GitHub tools, and multimedia tools use `effectiveUserId = context?.userId ?? closureUserId` for backward compatibility. Removed unused `_userId` parameters from web search, web scrape, and speech-to-text tool factories.

- **`web_search` and `web_scrape` migrated to ConnectorTools pattern** — `webSearch` and `webScrape` are no longer built-in singleton tools. They are now ConnectorTools-registered factories (`createWebSearchTool`, `createWebScrapeTool`) that bind to a specific connector. Use `ConnectorTools.for('my-serper')` to get prefixed search tools, or call the factory directly. Search service types: `serper`, `brave-search`, `tavily`, `rapidapi-search`. Scrape service types: `zenrows`, `jina-reader`, `firecrawl`, `scrapingbee`. The legacy env-var fallback (`SERPER_API_KEY`, etc.) has been removed — all auth goes through connectors.

### Removed

- **`webFetchJS` tool and Puppeteer dependency** — Removed the `web_fetch_js` tool (`tools.webFetchJS`) and the `puppeteer` optional dependency. The `webScrape` tool's fallback chain now goes directly from native fetch to external API providers. Sites requiring JavaScript rendering should use the `web_scrape` tool with an external scraping provider (ZenRows, Jina Reader, etc.) instead.

- **`tools.webSearch` and `tools.webScrape` singleton exports** — Replaced by `createWebSearchTool(connector)` and `createWebScrapeTool(connector)` factory functions. The old env-var-based search providers (`src/tools/web/searchProviders/`) have been removed.

## [0.1.4] - 2026-02-08

### Added

- **`getVendorDefaultBaseURL(vendor)` — Runtime vendor base URL resolution** — New exported function that returns the default API base URL for any supported vendor. For OpenAI/Anthropic, reads from the actual installed SDKs at runtime (`new OpenAI({apiKey:'_'}).baseURL`), ensuring URLs auto-track SDK updates. For OpenAI-compatible vendors (Groq, Together, Grok, DeepSeek, Mistral, Perplexity, Ollama) and Google/Vertex, uses known stable endpoints. Built once at module load via `ReadonlyMap` for zero per-request overhead. Primarily used by LLM proxy servers that need vendor URLs without instantiating full provider objects.

- **Google provider proxy support** — `GoogleTextProvider` now passes `config.baseURL` to the Google GenAI SDK via `httpOptions.baseUrl`, enabling transparent HTTP proxy routing. Previously, the Google SDK always connected directly to `generativelanguage.googleapis.com` regardless of the connector's `baseURL` setting.

### Fixed

- **LLM proxy: empty `baseURL` for LLM connectors** — LLM connectors stored without `baseURL` (because provider SDKs handle defaults internally) caused proxy servers to construct relative URLs like `fetch('/v1/messages')` which silently failed. The proxy now falls back to `getVendorDefaultBaseURL(vendor)` when the connector has no `baseURL`.

- **LLM proxy: vendor-specific auth headers** — Anthropic (`x-api-key`) and Google (`x-goog-api-key`) vendor-specific auth headers now take priority over a connector's generic `headerName` (e.g. `Authorization`). Previously, connectors with `headerName: 'Authorization'` would send the API key in the wrong header for these vendors, causing 401 errors.

### Changed

- **`createProvider()` refactored** — OpenAI-compatible vendor cases (Groq, Together, Perplexity, Grok, DeepSeek, Mistral, Ollama) now use `getVendorDefaultBaseURL()` instead of hardcoded URL strings, eliminating duplication and ensuring a single source of truth for vendor endpoints.

### Notes: LLM Proxy Implementation Guide

> **For implementors building LLM proxy servers** (e.g. forwarding SDK requests through a central server):
>
> 1. **Vendor URL resolution**: Use `getVendorDefaultBaseURL(connector.vendor)` as fallback when `connector.baseURL` is empty — LLM connectors typically don't store URLs since provider SDKs handle defaults internally.
>
> 2. **Auth header priority**: For Anthropic, always use `x-api-key`. For Google, always use `x-goog-api-key`. These must take priority over any generic `headerName` in the connector config.
>
> 3. **Body parser interference**: If your server uses `bodyParser.json()` middleware (Express, Meteor, etc.), it will consume the request stream before your proxy handler runs. Check `req.body` first and re-serialize with `JSON.stringify()` instead of reading the raw stream. The request body is just the prompt payload (few KB) — the response stream is unaffected.
>
> 4. **SSE streaming through Meteor/Express**: Compression middleware (e.g. Meteor's built-in `compression`) buffers entire responses before compressing. For SSE responses:
>    - Use `res.setHeader('Content-Encoding', 'identity')` **before** `writeHead()` — `setHeader()` populates the internal header map that compression checks via `getHeader()`. Passing headers only through `writeHead()` bypasses this check.
>    - Call `res.flush()` after each `res.write(chunk)` — compression middleware adds this method to force its buffer to flush immediately.
>    - Set `res.socket.setNoDelay(true)` to disable Nagle's algorithm.
>    - Set `X-Accel-Buffering: no` and `Cache-Control: no-cache` response headers.

- **`apps/api/` — Generic Extensible API Proxy** — New Cloudflare Worker (Hono) serving as a centralized API proxy for OneRingAI clients (Hosea, Amos). Full implementation includes:
  - **Auth system** — Signup, signin, JWT access/refresh tokens, PBKDF2 password hashing via Web Crypto
  - **Centralized model registry** — D1-backed model registry seeded from library `MODEL_REGISTRY`, with admin CRUD and pricing management
  - **Service registry** — Layered resolution (custom_services → service_overrides → library SERVICE_DEFINITIONS)
  - **Encrypted credential storage** — AES-GCM 256-bit encryption for user API keys
  - **Generic proxy** — Forwards requests to any configured service with auth injection, supports both buffered and SSE streaming responses
  - **Usage metering** — DB-driven pricing with platform token rates, vendor cost multipliers, or flat per-request costs. Automatic token deduction with full audit trail
  - **Billing endpoints** — Balance, subscription, transaction, and usage history
  - **Admin system** — Full admin API for user management (suspend/activate), token grants/adjustments, subscription plan changes, model registry CRUD, pricing management (per-model and bulk), service override configuration, platform key management, analytics dashboard, and audit log
  - **Integration tests** — Auth, admin, metering, and credential tests using `@cloudflare/vitest-pool-workers`

- **IMediaStorage Interface & FileMediaStorage** — Pluggable media storage following Clean Architecture.
  - New domain interface `IMediaStorage` with full CRUD: `save()`, `read()`, `delete()`, `exists()`, optional `list()`, `getPath()`
  - New infrastructure implementation `FileMediaStorage` (replaces `FileMediaOutputHandler`)
  - `setMediaStorage()` / `getMediaStorage()` replace `setMediaOutputHandler()` / `getMediaOutputHandler()`
  - `speech_to_text` tool now reads audio through storage (`handler.read()`) instead of hardcoded `fs.readFile()`
  - Tool parameter renamed: `audioFilePath` → `audioSource` in `speech_to_text`
  - Storage is threaded through `registerMultimediaTools()` and all tool factories
  - Deprecated aliases provided for all renamed exports (one version cycle)
  - Factory function `createFileMediaStorage()` for easy instantiation

- **GitHub Connector Tools** — First external service connector tools. When a GitHub connector is registered, `ConnectorTools.for('github')` automatically returns 7 dedicated tools:
  - `search_files` — Search files by glob pattern in a repository (mirrors local `glob`)
  - `search_code` — Search code content across a repository (mirrors local `grep`)
  - `read_file` — Read file content with line ranges from a repository (mirrors local `read_file`)
  - `get_pr` — Get full pull request details (title, state, author, labels, reviewers, merge status)
  - `pr_files` — Get files changed in a PR with diffs
  - `pr_comments` — Get all comments and reviews on a PR (merges review comments, reviews, issue comments)
  - `create_pr` — Create a pull request
  - Shared utilities: `parseRepository()` accepts `"owner/repo"` or full GitHub URLs, `resolveRepository()` with connector `defaultRepository` fallback
  - All tools auto-register via side-effect import following the multimedia tools pattern

### Fixed

- **Hosea: Connector tools not appearing without restart** — After creating/updating/deleting a universal connector in Hosea, `ConnectorTools.clearCache()` and tool catalog invalidation are now called so tools appear immediately without restarting the app.
- **Hosea: Connector tools grouped per-connector** — `connectorName` and `serviceType` are now passed through the full data pipeline (`OneRingToolProvider` → `UnifiedToolEntry` → IPC response) so the Agent Editor's per-connector collapsible sections render correctly instead of dumping all connector tools into a flat "API Connectors" category.
- **Generic API tool POST body handling** — Improved tool parameter descriptions to explicitly instruct LLMs to use the `body` parameter for POST/PUT/PATCH data instead of embedding request data as query string parameters in the endpoint URL. Previously, LLMs would often call e.g. `POST /chat.postMessage?channel=C123&text=hello` instead of using `body: { channel: "C123", text: "hello" }`, causing APIs like Slack to reject the request with "missing required field". The `describeCall` output now also includes truncated body content for easier debugging.

### Breaking Changes

- **Persistent Instructions Plugin - Granular KVP API** — `PersistentInstructionsPluginNextGen`
  now stores instructions as individually keyed entries instead of a single text blob.
  - **`IPersistentInstructionsStorage` interface changed**: `load()` returns `InstructionEntry[] | null`
    (was `string | null`), `save()` accepts `InstructionEntry[]` (was `string`). Custom storage
    backends (MongoDB, Redis, etc.) must be updated.
  - **Tool API changed**: `instructions_append` and `instructions_get` removed.
    Replaced with `instructions_remove` and `instructions_list`. `instructions_set` now takes
    `(key, content)` instead of `(content)`.
  - **Public API changed**: `set(content)` → `set(key, content)`, `append(section)` removed,
    `get()` → `get(key?)`, new `remove(key)` and `list()` methods.
  - **Config changed**: `maxLength` renamed to `maxTotalLength`, new `maxEntries` option.
  - **File format changed**: `custom_instructions.md` → `custom_instructions.json`.
    Legacy `.md` files are auto-migrated on first load.
  - **Session state format changed**: `restoreState()` handles both legacy and new formats.

## [0.1.3] - 2026-02-07

### Fixed

- Fix `getStateAsync is not a function` error in hosea app — updated callers to use the new synchronous `getState()` method on `WorkingMemoryPluginNextGen`

## [0.1.2] - 2026-02-06

### Added

- **Scoped Connector Registry** - Pluggable access control for multi-tenant connector isolation
  - `IConnectorRegistry` interface — read-only registry contract (`get`, `has`, `list`, `listAll`, `size`, `getDescriptionsForTools`, `getInfo`)
  - `IConnectorAccessPolicy` interface — sync predicate with opaque `ConnectorAccessContext`
  - `ScopedConnectorRegistry` class — filtered view over the Connector registry, gated by a user-provided policy
  - `Connector.setAccessPolicy()` / `Connector.getAccessPolicy()` — global policy management
  - `Connector.scoped(context)` — factory for scoped registry views
  - `Connector.asRegistry()` — unfiltered `IConnectorRegistry` adapter over static methods
  - `BaseAgentConfig.registry` — optional scoped registry for `Agent.create()`
  - `ConnectorTools.for()`, `discoverAll()`, `findConnector()`, `findConnectors()` now accept optional `{ registry }` option
  - Security: denied connectors produce the same "not found" error as missing ones (no information leakage)
  - 29 new unit tests

### Fixed

- **WorkingMemoryPluginNextGen state serialization** - `getState()` now returns actual entries instead of an empty array. Added synchronous `_syncEntries` cache to bridge the async `IMemoryStorage` with the synchronous `IContextPluginNextGen.getState()` contract. Session persistence now correctly saves and restores all Working Memory entries.
- **InContextMemory token limit enforcement** - `maxTotalTokens` config is now enforced. Added `enforceTokenLimit()` that evicts low-priority entries when total token usage exceeds the configured limit.
- **Token estimation consistency** - `simpleTokenEstimator` now uses `TOKEN_ESTIMATION.MIXED_CHARS_PER_TOKEN` from centralized constants instead of a hardcoded value.
- **System prompt precedence on session restore** - Explicit `instructions` passed to `Agent.create()` now take precedence over system prompts saved in restored sessions.

### Removed

- **Legacy compaction strategies** - Removed `src/core/context/strategies/` (ProactiveStrategy, AggressiveStrategy, LazyStrategy, AdaptiveStrategy, RollingWindowStrategy, BalancedStrategy). These legacy `IContextStrategy` implementations were dead code never imported by the NextGen context system.
- **SmartCompactor** - Removed `src/core/context/SmartCompactor.ts`. Not used by `AgentContextNextGen`.
- **ContextGuardian** - Removed `src/core/context/ContextGuardian.ts`. Not used by any production code.
- **Legacy strategy constants** - Removed `PROACTIVE_STRATEGY_DEFAULTS`, `AGGRESSIVE_STRATEGY_DEFAULTS`, `LAZY_STRATEGY_DEFAULTS`, `ADAPTIVE_STRATEGY_DEFAULTS`, `ROLLING_WINDOW_DEFAULTS`, `GUARDIAN_DEFAULTS` from `constants.ts`.
- **`WorkingMemoryPluginNextGen.getStateAsync()`** - Removed redundant async method; `getState()` now returns correct data synchronously.

### Changed

- **Documentation** - README.md, USER_GUIDE.md, and CLAUDE.md updated to reflect the actual NextGen compaction system. Replaced references to non-existent `proactive`/`balanced`/`lazy` strategy names with the actual `algorithmic` strategy (default, 75% threshold). Updated custom strategy guidance to use `ICompactionStrategy` + `StrategyRegistry`.

## [0.1.1] - 2026-02-06

### Fixed
- **Multimedia tool naming collisions** - Multiple vendors registering tools with the same base name (e.g., `generate_image`) caused only the last vendor's tools to survive deduplication in UIs. `ConnectorTools.for()` now prefixes service-specific tool names with the connector name (e.g., `google_generate_image`, `main-openai_text_to_speech`), matching the existing generic API tool pattern (`${connector.name}_api`).
- **ToolRegistry display names** - `ToolRegistry` now resolves vendor display names via `getVendorInfo()` and strips connector prefixes for clean display names (e.g., "OpenAI Generate Image", "Google Text To Speech").

### Changed
- **ConnectorTools.for()** - Service-specific tools returned by registered factories are now prefixed with `${connector.name}_`. This is a **breaking change** if you reference multimedia tool names by their old unprefixed names (e.g., `generate_image` → `google_generate_image`).
- **ToolRegistry.deriveDisplayName()** - Accepts `connectorName` parameter, strips connector prefix, prepends vendor display name.

## [0.1.0] - 2026-02-05

### Added
- Initial release of `@everworker/oneringai`
- **Connector-First Architecture** - Single auth system with named connectors
- **Multi-Provider Support** - OpenAI, Anthropic, Google, Groq, DeepSeek, Mistral, Grok, Together, Ollama
- **AgentContextNextGen** - Plugin-based context management
  - WorkingMemoryPluginNextGen - Tiered memory with automatic eviction
  - InContextMemoryPluginNextGen - Key-value storage directly in context
  - PersistentInstructionsPluginNextGen - Disk-persisted agent instructions
- **ToolManager** - Dynamic tool management with enable/disable, namespaces, circuit breakers
- **Tool Execution Plugins** - Pluggable pipeline for logging, analytics, custom behavior
- **Session Persistence** - Save/load full context state with `ctx.save()` and `ctx.load()`
- **Audio Capabilities** - Text-to-Speech and Speech-to-Text (OpenAI, Groq)
- **Image Generation** - DALL-E 3, gpt-image-1, Google Imagen 4
- **Video Generation** - OpenAI Sora 2, Google Veo 3
- **Web Search** - Serper, Brave, Tavily, RapidAPI providers
- **Web Scraping** - ZenRows with JS rendering and anti-bot bypass
- **Developer Tools** - read_file, write_file, edit_file, glob, grep, list_directory, bash
- **MCP Integration** - Model Context Protocol client for stdio and HTTP/HTTPS servers
- **OAuth 2.0** - Full OAuth support with encrypted token storage
- **Vendor Templates** - Pre-configured auth for 43+ services
- **Model Registry** - 23+ models with pricing, context windows, feature flags
- **Direct LLM Access** - `runDirect()` and `streamDirect()` bypass context management
- **Algorithmic Compaction** - Strategy-based context compaction via `StrategyRegistry`

### Providers
- OpenAI (GPT-5.2, GPT-5, GPT-4.1, o3-mini)
- Anthropic (Claude 4.5 Opus/Sonnet/Haiku, Claude 4.x)
- Google (Gemini 3, Gemini 2.5)
- Groq, DeepSeek, Mistral, Grok, Together AI, Ollama

[0.4.0]: https://github.com/aantich/oneringai/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/aantich/oneringai/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/aantich/oneringai/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/aantich/oneringai/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/aantich/oneringai/compare/v0.2.1...v0.2.3
[0.1.3]: https://github.com/aantich/oneringai/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/aantich/oneringai/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/aantich/oneringai/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aantich/oneringai/releases/tag/v0.1.0
[Unreleased]: https://github.com/aantich/oneringai/compare/v1.1.5...HEAD
[1.1.5]: https://github.com/aantich/oneringai/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/aantich/oneringai/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/aantich/oneringai/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/aantich/oneringai/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/aantich/oneringai/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/aantich/oneringai/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/aantich/oneringai/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/aantich/oneringai/compare/v0.11.0...v1.0.0
[0.11.0]: https://github.com/aantich/oneringai/compare/v0.10.3...v0.11.0
