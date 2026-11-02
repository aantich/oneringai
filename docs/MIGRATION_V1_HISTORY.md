# Historical v1 upgrade notes

These are the upgrade instructions as recorded for the v1 releases. Version numbers,
SDK baselines, package names, and availability statements in these notes describe
that release, not the current v2 contract. For current installation and migration use
[Package migration](PACKAGE_MIGRATION.md), the [User Guide](../USER_GUIDE.md), and
[model lifecycle metadata](MODEL_REGISTRY_AUDIT.md).

## Upgrading to 1.2.0

OneRingAI 1.2.0 is a source-compatible API and model refresh for OpenAI,
Anthropic, Google, and xAI. It keeps the connector-first Agent surface intact
while adding current model metadata, provider-hosted tools, continuation state,
and connector-first clients for vendor APIs that do not fit `Agent.run()`.

Install the release and rebuild any code that imports OneRingAI's public
TypeScript unions:

```bash
npm install @everworker/oneringai@^1.2.0
```

| Change | Who is affected | Required action |
|--------|-----------------|-----------------|
| October model refresh | Model pickers, routers, and cost estimators | Re-read registry metadata and prefer lifecycle/availability fields instead of hard-coded model lists |
| Expanded output and stream unions | Applications with exhaustive `ContentType`, `InputItem`, or `StreamEventType` switches | Handle provider-state items, replayable reasoning, compaction, continuation tokens, and typed native-tool results |
| Current OpenAI Responses tools | Hosts executing computer, shell, patch, or client tool-search calls | Use `runDirect()`, preserve the original `call_id`, enforce host approval, and return the matching typed output item |
| Anthropic tool-search/compaction state | Hosts that persist or inspect managed history | Persist opaque provider state unchanged; do not interpret or manufacture server-owned blocks |
| Gemini 3.8 Interactions | Google callers using stored interactions, file search, or computer use | Preserve continuation tokens and signed thought state; keep screenshots and tool execution under trusted host control |
| Dedicated xAI text adapter | Grok callers using hosted tools or usage telemetry | Use the normal Grok connector; read normalized native-tool, reasoning, and cost fields rather than OpenAI-specific wire objects |
| Current SDK baseline | Custom adapters importing vendor SDK types | Recompile against `openai` 7.30, `@anthropic-ai/sdk` 0.131, and `@google/genai` 2.27 |
| Refreshed built-in tool fingerprints | Hosts exchanging portable Agent packages | Upgrade exporting and receiving runtimes together so protocol-v2 executable fingerprints match |

The new public clients are `OpenAIDecisions`, `OpenAILiveSession`,
`OpenAIVoices`, `GoogleLiveSession`, and `GoogleVoices`. They all resolve
credentials through a named `Connector`; do not pass API keys to their methods.
See [Current vendor API additions](../USER_GUIDE.md#current-vendor-api-additions) for runnable
examples and [Model Registry](../USER_GUIDE.md#model-registry) for the refreshed catalog.

OpenAI GPT-6 Astra and GPT-6.1 Sol reject `none` and `minimal` reasoning. GPT-6
Sol and Luna allow sampling controls only when the effective effort is `none`.
Fast and Ultrafast processing remain unavailable through OpenAI's EU data
residency endpoint; Ultrafast requires global processing or US data residency.
OneRingAI validates explicit invalid combinations before inference.

Managed Agent loops now retain ordered reasoning, compaction, native-tool, and
opaque provider output across tool turns. Direct callers remain responsible for
resending provider-required state when they construct continuations manually.
Never synthesize signatures, encrypted reasoning, or provider-state records.


## Upgrading to 1.1.3

OneRingAI 1.1.3 updates the text, image, video, speech, and embedding model
registries against current vendor documentation. Public APIs remain
source-compatible. Registry-driven model selection now prefers current models
and excludes retired entries, while callable deprecated models retain explicit
deprecation and retirement dates.

The 1.1.3 notes described Sora 2 and Sora 2 Pro as callable before the
September 24, 2026 shutdown. That historical availability no longer applies:
the current provider rejects Sora generation locally with status 410. See the
[model registry audit](MODEL_REGISTRY_AUDIT.md) for the complete vendor,
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
[OpenAI Realtime API](../USER_GUIDE.md#openai-realtime-api) and
[xAI Realtime Voice Agent API](../USER_GUIDE.md#xai-realtime-voice-agent-api).

### 6. Review model defaults and media behavior

Current recommended starting points are:

| Workload | Recommended model/API |
|----------|-----------------------|
| Highest-capability OpenAI text/agents | `gpt-6-astra` |
| Balanced OpenAI production agents | `gpt-6.1-sol` |
| Economical OpenAI high-throughput work | `gpt-6-luna` |
| Anthropic frontier work | `claude-opus-5-5`; use `claude-sonnet-5-5` for a faster path |
| Google multimodal/agent work | `gemini-3.8-flash` through Interactions |
| xAI text/agent work | `grok-4.7` |
| OpenAI image generation/editing | `gpt-image-2.5-sunburst` |
| Google native image | `gemini-nano-banana-2.1` |
| xAI image quality | `grok-imagine-image-2.0` |
| Google multimodal embeddings | `gemini-embedding-2` |
| Google low-cost video | `veo-3.1-lite-generate-preview` |
| xAI higher-fidelity image-to-video | `grok-imagine-video-1.5` |
| OpenAI realtime voice | `gpt-realtime-2.1` |
| xAI realtime voice | `grok-voice-latest` |
| File transcription | `gpt-transcribe`, `gemini-3.5-transcribe`, or `grok-voice-transcribe-2.0` |

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
[`docs/MODEL_REGISTRY_AUDIT.md`](MODEL_REGISTRY_AUDIT.md).

---
