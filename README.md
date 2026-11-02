# oneringai

**Build agents around your application, and choose who runs them.**

OneRingAI is a TypeScript library for agents, authenticated tools, long-term
memory, and multimodal AI. Use its own agent loop with multiple model providers,
or bind one agent definition to a supported OpenAI or Anthropic harness.
Named connectors keep credentials and account access in your application.

[![MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B%20%7C%2024%2B-black.svg)](https://nodejs.org/)

**Start here:** [User Guide](USER_GUIDE.md) · [Examples](examples/README.md) ·
[API Reference](API_REFERENCE.md) · **[AMOS cookbook](apps/amos/docs/AGENT_RUNTIME.md)**

AMOS is the complete terminal application: configure connectors, run agents,
switch harnesses, inspect activity, and recover saved sessions. Its
[application guide](apps/amos/README.md) also covers native OneRingAI mode.

**v2 package:** **`oneringai`**, without a scope. This documentation targets
`2.0.0-beta.1`; use the matching package version and retain the preview boundaries
below. Existing v1 users must migrate explicitly from `@everworker/oneringai`.
See [migration](docs/PACKAGE_MIGRATION.md) and [release readiness](docs/RELEASE_READINESS_V2.md).

## What changes in v2

Version 2 adds control over long tasks, source retention, model spending, and
complete agent harnesses. It builds on the connectors, memory system, tools,
context plugins, and media APIs already available in v1.

| Capability | What it lets you do | Read more |
| --- | --- | --- |
| **Interchangeable agent harnesses** | Define instructions and selected application tools once; bind OneRingAI, local Codex/Claude SDKs, or managed OpenAI/Claude agents per session | [Agent Runtime](USER_GUIDE.md#agent-runtime-preview) |
| **Durable evidence** | Retain scoped source observations while sending bounded projections to the model; repair storage without repeating an action | [Evidence](docs/DURABLE_EVIDENCE.md) |
| **Protected task state** | Keep host-confirmed constraints, corrections, questions, and action receipts through compaction | [Task state](docs/TASK_STATE.md) |
| **Reliable context preparation** | Account for the final request, preserve connected tool groups, and stop explicitly when protected content cannot fit | [Preparation](docs/CONTEXT_PREPARATION.md) |
| **Selectable context strategies** | Opt into evidence-backed observation masking, structured summaries, selective plugin data, or supported native compaction | [Strategies](docs/CONTEXT_STRATEGIES.md), [assembly](docs/CONTEXT_ASSEMBLY.md), [native compaction](docs/NATIVE_CONTEXT_COMPACTION.md) |
| **Model routes, helpers, and budgets** | Select named managed routes, invoke bounded helper models, and share a process-local `ModelTask` allowance | [Routing](docs/MODEL_ROUTING.md), [helpers and budgets](docs/MODEL_TASKS_AND_HELPERS.md) |
| **Inspectable tool outcomes** | Distinguish execution failure from ordinary application data, propagate cancellation, and retain late outcomes | [Outcomes](docs/TOOL_OUTCOMES_AND_CANCELLATION.md) |
| **Verified workflows** | Add bounded recovery, host completion checks, routine verification, and fully configured worker agents | [Loop policies](docs/AGENT_LOOP_POLICIES.md), [routines](docs/VERIFIED_ROUTINES.md), [orchestration](docs/ORCHESTRATOR_FACTORY.md) |
| **Stronger connector and remote-tool contracts** | Explicitly select audited execution profiles, whole collection pages, or negotiated remote outcomes | [Connectors](docs/ENHANCED_CONNECTORS.md), [pages](docs/CONNECTOR_COLLECTION_PAGES.md), [remote outcomes](docs/REMOTE_TOOL_OUTCOMES.md) |
| **Small adoption presets** | Start with `research` or `workflow`, inspect the effective configuration, and override ordinary Agent options | [Presets](docs/AGENT_PRESETS.md) |

New policies and features are opt-in unless their guide describes a compatibility
fix. Ordinary `Agent.create()` defaults and existing session contracts remain
supported. Native Agent controls do not automatically apply inside external
vendor harnesses. The [v2 adoption guide](docs/VERSION_2_GUIDE.md) records exact
availability, limitations, validation, and deferred work.

## Quick start

Node.js **22.13+ or 24+** is required. The package provides ESM, CommonJS, and
TypeScript declarations. Stable v2 installs use:

```bash
npm install oneringai
```

For published v2 prereleases use `npm install oneringai@next`. Before registry
availability, use a [source checkout or locally packed package](docs/PACKAGE_MIGRATION.md#try-v2-before-publication).
Load your own environment configuration before creating connectors; the library
does not automatically load your application's `.env` file.

```typescript
import { Agent, Connector, Vendor } from 'oneringai';

Connector.create({
  name: 'openai-main',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

const agent = Agent.create({
  connector: 'openai-main',
  model: 'gpt-5.6-terra',
  instructions: 'Be accurate, concise, and explicit about uncertainty.',
});

try {
  const response = await agent.run('Explain connector-first architecture.');
  console.log(response.output_text);
} finally {
  agent.destroy();
}
```

Register an Anthropic, Google, xAI, or other supported connector and change the
agent's connector/model to use another provider. Your task code and tools stay
the same; model capabilities and provider-specific request boundaries still apply.

| Goal | API |
| --- | --- |
| Stateful assistant with tools and managed context | `Agent.create()` → `run()` / `stream()` |
| One direct model call | `runDirect()` / `streamDirect()` |
| Switch complete agent harnesses | `AgentRuntime.createAgent()` → session execution binding |
| Coordinate native OneRingAI agents | `createOrchestrator()` / `createOrchestratorWithFactory()` |
| Use knowledge outside an agent | `MemorySystem` |
| Generate media or embeddings | Dedicated capability classes below |

The [User Guide](USER_GUIDE.md#getting-started) explains setup and response shapes;
the [examples guide](examples/README.md) gives exact commands, credentials,
expected behavior, side effects, and cleanup.

## Connectors: one authentication system

Connectors are named credential and service identities. Multiple API keys,
accounts, and vendors can coexist. AI connectors declare an explicit `Vendor`;
external-service connectors use `serviceType` and endpoint configuration.

```typescript
import { Agent, Connector, Services } from 'oneringai';

// Reuses the AI connector from the quick start.
Connector.create({
  name: 'github-work',
  serviceType: Services.Github,
  auth: { type: 'api_key', apiKey: process.env.GITHUB_TOKEN! },
  baseURL: 'https://api.github.com',
});

const assistant = Agent.create({
  connector: 'openai-main',
  model: 'gpt-5.6-terra',
  identities: [{ connector: 'github-work' }],
  permissions: {
    onApprovalRequired: async request => ({
      approved: request.toolName === 'github-work_api' && request.args.method === 'GET',
    }),
  },
});

try {
  await assistant.run('List open issues in owner/repository.');
} finally {
  assistant.destroy();
}
```

There are **50 authentication templates**, plus a generic authenticated API tool
for configured connectors with a `baseURL`. Specialized packs cover GitHub,
Slack, Microsoft Graph, Google Workspace, Telegram, Twilio, Zoom, search,
scraping, and AI media. Not every template has a specialized pack. Use
`ConnectorTools.for(name)` when composing tool lists explicitly.

OAuth supports per-user/account tokens, refresh, encrypted storage, and multiple
flows. `Connector.fetch()` provides direct authenticated requests with configurable
timeouts, retry, circuit breakers, and diagnostics. Scoped registries and identity
filters compose with host authorization; setting `userId` alone does not establish
tenant isolation or grant access.

See the [complete connector and tool catalog](docs/CONNECTOR_TOOL_CATALOG.md),
[authentication guide](USER_GUIDE.md#connectors--authentication),
[OAuth guide](USER_GUIDE.md#oauth-for-external-apis), and
[scoped registries](USER_GUIDE.md#scoped-connector-registry).

## Memory: knowledge beyond conversation history

The standalone **`MemorySystem`** represents knowledge as entities and
provenance-aware facts. Use it directly in an application, connect it to agents,
or feed it through a signal-ingestion pipeline.

| Area | Included capabilities |
| --- | --- |
| Knowledge | Typed entities, aliases and identifiers; atomic, relational, and document facts; confidence, importance, provenance, supersession, and temporal history |
| Retrieval | Ranked recall, fact/document semantic search, graph traversal, related tasks/events, and bitemporal queries |
| Learning | Entity resolution, text/email/calendar ingestion, incremental profiles, background conversation ingestion, and scoped behavior rules |
| Storage | In-memory adapter, Mongo adapters with graph/vector support and migration helpers, or custom `IMemoryStore` |
| Access | Required ownership, owner/group/world permissions, optional principal ACLs, and host-selected tool scopes |

Enable `context.features.memory` for profile injection and **six read tools**.
Add `memoryWrite` for **six write tools**, or use background ingestion with a
retrieval-only agent. Configure a trusted owner and explicit visibility policy
for multi-user applications. The compatibility default permits public reads.

Memory differs from working notes, conversation checkpoints, and execution
evidence: each has its own scope, lifecycle, and purpose.

Start with the [Memory Guide](docs/MEMORY_GUIDE.md) and
[agent integration walkthrough](USER_GUIDE.md#self-learning-memory-nextgen-plugin).
Detailed references cover the [API](docs/MEMORY_API.md),
[permissions](docs/MEMORY_PERMISSIONS.md), [predicates](docs/MEMORY_PREDICATES.md),
and [signals](docs/MEMORY_SIGNALS.md).

## Tools and context that compose

An Agent and its `AgentContextNextGen` share **one ToolManager**:
`agent.tools === agent.context.tools`. Tools can come from application functions,
generated built-ins, context plugins, connectors, or MCP servers. Register,
enable, disable, and organize them through the same manager.

Context plugins own their instructions, prompt data, tools, compaction, and saved
state. Disabled features contribute no tools or prompt content.

| Plugin capability | Default | Purpose |
| --- | --- | --- |
| Working memory | On | Tiered scratch notes with bounded retrieval |
| In-context memory | On | Small live whiteboard in the prompt |
| Long-term memory / memory writes | Off | Scoped knowledge retrieval / mutation |
| Tool catalog | Off | Discover and load selected tool categories |
| Shared workspace | Off | Team coordination through one explicitly shared workspace |
| Evidence | Off | Acknowledged observations and source references |
| Task state | Off | Host-controlled constraints, notes, and action receipts |
| Persistent instructions / user info | Off | Compatibility stores; prefer the memory system for new integrations |

The tool pipeline supports permission policies, user rules, execution plugins,
timeouts, circuit breakers, cancellation, outcomes, and observation. Shell,
desktop, generated-code, and remote tools require deliberate host policies.
Serializing tool state does not serialize executable functions or authorization.

See [tools](USER_GUIDE.md#tools--function-calling),
[permissions](USER_GUIDE.md#tool-permissions), [context](USER_GUIDE.md#context-management),
[MCP](MCP_INTEGRATION.md), and [session persistence](USER_GUIDE.md#session-persistence).

## One definition, multiple agent harnesses

`AgentRuntime` separates a logical definition from its execution binding.
The harness is explicit; a model name never selects it.

| Harness | Driver ID | Current integration boundary |
| --- | --- | --- |
| Native OneRingAI | `oneringai.agent` | Existing Agent loop, plugins, tools, and supported text providers |
| Local OpenAI Codex SDK | `openai.codex.sdk` | Optional SDK, local workspace policy, authenticated host-tool MCP |
| Local Claude Agent SDK | `anthropic.agent.sdk` | Optional SDK; initial profile enables selected host functions only |
| OpenAI managed Agents API | `openai.agents.api` | Durable control storage; no environment or explicit hosted sandbox |
| Claude Managed Agents API | `anthropic.managed.api` | Durable control storage and provider-managed environment |

The following assumes the named OpenAI connector from the quick start and the
optional peer `npm install @openai/codex-sdk`:

```typescript
import { AgentRuntime, LocalExecutionBackend } from 'oneringai/agent-runtime';
import { CodexSdkDriver } from 'oneringai/agent-runtime/codex';

const runtime = new AgentRuntime({
  backend: new LocalExecutionBackend({ drivers: [new CodexSdkDriver()] }),
});
const assistant = runtime.createAgent({
  id: 'project-assistant',
  instructions: 'Inspect the project and explain your findings.',
});

try {
  const options = {
    execution: {
      driver: 'openai.codex.sdk', connector: 'openai-main', model: 'gpt-6.1-sol',
    },
    context: { userId: 'authenticated-owner' },
    environment: { type: 'local-directory' as const, path: process.cwd() },
    policy: {
      filesystem: 'read-only' as const, commands: 'sandboxed' as const,
      sandboxNetwork: 'denied' as const, providerWebSearch: 'denied' as const,
      approvals: 'deny' as const,
    },
  };
  console.log(await assistant.inspect(options));
  const session = await assistant.openSession(options);
  const run = await session.run('Explain this project.', { requestId: 'overview-1' });
  for await (const event of run.events()) console.log(event.type);
  console.log((await run.result).outputText);
} finally {
  await runtime.destroy();
}
```

Register another driver and bind the same definition with its connector, model,
policy, and supported environment. For selected application tools, supply a
host-owned resolver; see the [five-harness example](examples/agent-runtime-swappable.ts).
Capabilities reject unsupported requirements before execution. Managed recovery
uses scoped references and original request IDs rather than replaying uncertain
input. File transfer is a separate host-authorized operation.

**Runtime status: preview.** All five adapters have deterministic offline
coverage. A bounded Codex subscription test and small OpenAI model-call sample
are recorded in [live validation](docs/evaluations/LIVE_VALIDATION_2026_11_01.md).
Production API-key Codex, Claude SDK, and both managed agent APIs still need
their live/platform gates. Production drivers require named API-key connectors;
the subscription test used an explicit test-only bootstrap and adds no public
subscription-login feature.

Follow the [runtime guide](USER_GUIDE.md#agent-runtime-preview) and
**[AMOS runtime cookbook](apps/amos/docs/AGENT_RUNTIME.md)** for controls,
authentication, continuation, files, cancellation, durability, and cleanup.
App Server interactivity, distributed isolation, and A2A remain deferred.

## Models, media, and provider APIs

Text adapters support OpenAI, Anthropic, Google Gemini, Google Vertex AI, xAI,
DeepSeek, Groq, Together, Mistral, Perplexity, Ollama, and custom compatible
deployments. Feature support depends on the actual model, endpoint, and adapter.
Use registries and capability inspection instead of a provider-wide checkbox.

| Need | Public surface | Guide |
| --- | --- | --- |
| JSON, reasoning, caching, batches, and hosted tools | Agent run/direct options and `getAdvancedCapabilities()` | [Inference](USER_GUIDE.md#advanced-inference) |
| Images and document understanding | `createMessageWithImages`, `DocumentReader`, `readDocumentAsContent` | [Vision](USER_GUIDE.md#multimodal-vision), [documents](USER_GUIDE.md#document-reader) |
| Image generation/editing | `ImageGeneration` | [Images](USER_GUIDE.md#image-generation) |
| Video jobs | `VideoGeneration` | [Video](USER_GUIDE.md#video-generation) |
| Speech synthesis/transcription | `TextToSpeech`, `SpeechToText`, `VoiceStream` | [Audio](USER_GUIDE.md#audio-ttsstt) |
| Live voice and telephony | Agent-aware Realtime sessions, browser WebRTC peer, `VoiceBridge` | [Realtime](USER_GUIDE.md#openai-realtime-api) |
| Text/multimodal vectors | `Embeddings` | [Embeddings](USER_GUIDE.md#embeddings) |
| Web research | `SearchProvider`, `ScrapeProvider`, connector tools | [Search](USER_GUIDE.md#web-search), [scraping](USER_GUIDE.md#web-scraping) |
| Model selection and UI | Model registries, endpoint capabilities, parameter policy, vendor presentation | [Registry](USER_GUIDE.md#model-registry), [endpoint metadata](docs/ENDPOINT_CAPABILITIES.md), [parameter policy](docs/PARAMETER_POLICY.md), [presentation](docs/VENDOR_PRESENTATION.md) |

Provider-hosted tools have separate execution and data-handling boundaries from
local `ToolFunction`s. Media APIs are not available from every text provider.
Retired compatibility entries, including OpenAI Sora, remain discoverable as
historical metadata and must not be offered as active generation options.
Registry cost calculations are estimates; missing pricing or usage remains
unknown. Check the [registry audit](docs/MODEL_REGISTRY_AUDIT.md) and provider
sources linked there for access, lifecycle, and billing details.

## Applications and examples

- **[AMOS](apps/amos/README.md)** — MIT terminal application with connectors,
  tools, native Agent commands, and an opt-in harness-neutral runtime mode.
- **[Hosea](apps/hosea/README.md)** — MIT Electron application with a reusable
  monochrome design system and a local design-preview launcher. Its
  [backend integration](apps/hosea/docs/BACKEND_INTEGRATION.md) is preserved and
  disabled by default. Desktop packaging has separate validation gates.
- **[Examples index](examples/README.md)** — basic integrations, memory,
  context strategies, verified workflows, runtime bindings, and recovery.

From a checkout with development dependencies, these demonstrations use
synthetic providers and require no API credentials:

```bash
npm install
npm run build
npm run example:agentic-baseline
npm run example:context-strategies
npm run example:model-routing
npm run example:agent-runtime-swappable
npm run example:agent-runtime-recovery
npm run example:amos-runtime
```

The examples index documents live opt-ins separately. They can make billable
requests; ordinary offline examples do not establish provider access.

## Documentation

| Task | Start here |
| --- | --- |
| Learn the complete API | [User Guide](USER_GUIDE.md), [generated API Reference](API_REFERENCE.md) |
| Give a coding agent the right context | [AGENTS.md](AGENTS.md), [Claude entry point](CLAUDE.md) |
| Run a complete application | [AMOS cookbook](apps/amos/docs/AGENT_RUNTIME.md), [AMOS guide](apps/amos/README.md), [Hosea](apps/hosea/README.md) |
| Discover integrations | [Connector & Tool Catalog](docs/CONNECTOR_TOOL_CATALOG.md) |
| Build long-term knowledge | [Memory Guide](docs/MEMORY_GUIDE.md), [Memory API](docs/MEMORY_API.md), [permissions](docs/MEMORY_PERMISSIONS.md) |
| Adopt v2 incrementally | [Version 2 Guide](docs/VERSION_2_GUIDE.md), [package migration](docs/PACKAGE_MIGRATION.md) |
| Verify guarantees and limits | [Evidence conformance](docs/EVIDENCE_CONFORMANCE.md), [capacity inventory](docs/CONSUMER_CAPACITY_INVENTORY.md), [evaluation](docs/AGENTIC_BASELINE_EVALUATION.md) |
| Review architecture | [Agent Runtime](docs/designs/AGENT_RUNTIME.md), [distributed execution](docs/designs/DISTRIBUTED_AGENT_EXECUTION.md), [evolution roadmap](docs/designs/AGENTIC_ARCHITECTURE_EVOLUTION.md) |
| Prepare a release or upgrade | [Readiness report](docs/RELEASE_READINESS_V2.md), [Changelog](CHANGELOG.md), [historical v1 upgrades](docs/MIGRATION_V1_HISTORY.md) |

Repository documentation links are relative so they follow the checkout's
branch. The following two links are the deliberate **npm landing-page version
navigation exception**: [legacy v1 documentation](https://github.com/aantich/oneringai/blob/version1/README.md)
and [v2 documentation on main after the release merge](https://github.com/aantich/oneringai/blob/main/README.md).
Until that merge, main may still describe v1; use this checkout's relative links
for the prepared v2 documentation.

## Development

```bash
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run examples:check
npm run test:agentic:compat
npm run docs
npm run docs:check
```

See [Contributing](CONTRIBUTING.md) for the development workflow. Use public
exports in consumer code; generated registries and API documentation are
regenerated from source. Integration/live suites require explicit setup and are
separate from the offline release checks.

## License

The library, AMOS, and Hosea source are **MIT licensed**, Copyright © 2025–2026
Anton Antic ([anton.antich@gmail.com](mailto:anton.antich@gmail.com)).
See [LICENSE](LICENSE) and [Licensing](LICENSING.md) for scope and third-party terms.

Questions and bug reports: [GitHub issues](https://github.com/aantich/oneringai/issues).
