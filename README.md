# @everworker/oneringai

> **A unified AI agent library with multi-provider support for text generation, image/video generation, audio (TTS/STT), and agentic workflows.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.13%2B%20%7C%2024%2B-green.svg)](https://nodejs.org/)

## What's new in 1.2.0

OneRingAI 1.2.0 expands the GPT-6 Astra work into a current,
capability-checked API layer for all four major vendors.

- **OpenAI and Astra:** Adds GPT-6.1 Sol, GPT-6 Sol, GPT-6 Luna,
  GPT-5.6 Cyber, and GPT-Rosalind Research alongside Astra. The Responses
  integration now preserves ordered text, tool, compaction, and reasoning state
  through managed tool loops and supports the newest hosted tools. Computer-use
  screenshot continuations accept either data URLs or uploaded file IDs. GPT-6
  sampling controls are validated against the effective reasoning effort. New
  connector-first wrappers cover Decisions, GPT-Live WebSockets, and custom
  voice creation.
- **Anthropic:** Adds Claude Opus 5.5 and Sonnet 5.5 with their distinct
  adaptive-thinking rules, current server-tool versions, deferred tools,
  programmatic callers, compaction, and native tool search. Provider-owned
  blocks and distinct signed-thinking blocks are retained in provider order so
  tool-search continuations can be replayed faithfully.
- **Google:** Adds Gemini 3.8 Flash and Live variants, Interactions continuation
  tokens, file search, computer use, background Live status, custom voices,
  Gemini 3.8 TTS, and Nano Banana 2.1 image generation. Streaming preserves
  signed thought state and provider usage across continuations.
- **xAI:** Adds Grok 4.7, native X search and hosted coding tools, reasoning and
  cost telemetry, plus Grok Voice Transcribe 2.0 through a dedicated provider.

Model and API access can still be organization- or region-gated by each vendor.
Read the [Astra and current vendor API guide](./USER_GUIDE.md#gpt-6-astra-responses-extensions),
the [1.2.0 changelog](./CHANGELOG.md), and the
[model registry audit](./docs/MODEL_REGISTRY_AUDIT.md).

## Built for coding agents

OneRingAI ships a canonical **[Agent Guide](./AGENTS.md)** that gives Codex,
Claude Code, and custom coding agents the complete mental model they need to
work with the library: connector-first authentication, agents and execution
modes, tools, context plugins, memory, multimodal APIs, orchestration, MCP,
tenancy, persistence, documentation routing, and validation.

In this repository, `AGENTS.md` is the shared source of truth and
[`CLAUDE.md`](./CLAUDE.md) directs Claude Code to it. When OneRingAI is installed
from npm, both files—plus the public API reference and specialist memory/tool
guides—are included in the package. If an agent does not discover the guide
automatically, give it this one instruction:

```text
Before writing OneRingAI code, read
node_modules/@everworker/oneringai/AGENTS.md in full. Follow its connector-first
patterns, use only public package exports, and consult the specialist document
it routes you to before guessing an API.
```

That is enough to orient an agent before asking it to build something:

```text
Now create a TypeScript research agent that uses my named OpenAI connector,
Serper for search, ZenRows for scraping, and the tool catalog. Keep credentials
out of code and add a runnable smoke test.
```

Custom agents can load the same file into their system/developer context. The
guide is deliberately concise enough to load as context while linking to the
full User Guide, API reference, connector/tool catalog, memory documentation,
and runnable examples when deeper work is required.

## Agent Runtime: run complete agents through one API

The preview **Agent Runtime** is the integration layer for pre-built agent
systems—not merely another text-model adapter. It lets an application or
workflow select a native OneRingAI agent or an OpenAI Codex SDK agent through
the same specification/session/run API while each driver keeps its own agent
loop, tools, context, and workspace behavior.

| What the runtime normalizes | Current local-preview behavior |
|-----------------------------|--------------------------------|
| Drivers | Native OneRingAI agents and the optional Codex TypeScript SDK |
| Selection | Agent, model, and model-validated reasoning effort at spec or per-run scope |
| Observation | Live messages, vendor-exposed reasoning, and tool/command/file activity when exposed by the selected driver, plus usage and terminal results |
| Control | Autonomous, observable runs; approvals and steering are capability-gated and not yet implemented locally |
| Safety | Explicit policy, bounded output/events, cancellation cleanup, one writer per workspace, and fail-closed workspace quarantine |
| Placement | Trusted local execution today; isolated container/microVM execution is the planned server backend |

The example below assumes an OpenAI connector named `openai-main`; install
`@openai/codex-sdk` when enabling the optional Codex driver.

```typescript
import {
  AgentRuntime,
  LocalExecutionBackend,
} from '@everworker/oneringai/agent-runtime';
import { CodexSdkDriver }
  from '@everworker/oneringai/agent-runtime/codex';

const runtime = new AgentRuntime({
  backend: new LocalExecutionBackend({ drivers: [new CodexSdkDriver()] }),
});

const codingAgent = runtime.agent({
  id: 'coding-agent',
  driver: 'openai.codex.sdk',
  connector: 'openai-main',
  model: 'gpt-5.3-codex',
  reasoning: { effort: 'high' },
});
```

Autonomous does not mean opaque: callers can consume `run.events()` to render
the agent’s ongoing work without pausing it for approval. Unsupported features
fail in capability preflight instead of silently degrading.

Start with the **[detailed Agent Runtime guide](./USER_GUIDE.md#agent-runtime-preview)**,
run the **[local OneRingAI/Codex example](./examples/agent-runtime-local.ts)**,
and use the **[design document](./docs/designs/AGENT_RUNTIME.md)** for architectural
decisions, security boundaries, and the server/App Server/Claude/A2A roadmap.

## Meet AMOS: a terminal agent built with OneRingAI

> **Want to see the library running as a real application?** AMOS is the
> terminal-based AI assistant in this repository, built entirely on OneRingAI.

AMOS turns the library's core capabilities into an interactive CLI: configure
named connectors, switch vendors and models without restarting, use guarded
filesystem and shell tools, search with Serper, scrape with ZenRows, inspect
context usage, and save or resume working sessions.

**[Explore AMOS, its commands, and local setup →](./apps/amos/README.md)**

## Memory is a first-class subsystem

OneRingAI includes a complete, standalone **`MemorySystem`**—not just chat
history and not a thin vector-store wrapper. It models knowledge as typed
entities and provenance-aware facts, combines graph traversal with vector
search, resolves repeated mentions to stable identities, and turns accumulated
observations into evolving profiles. It is substantial enough to be its own
package, but ships as part of OneRingAI so agents, connectors, embeddings,
permissions, and context injection work together without integration glue.

| Capability | What the memory layer provides |
|------------|--------------------------------|
| Knowledge model | Entities, atomic and relational facts, typed metadata, aliases, multiple identifiers, confidence, importance, provenance, `contextIds`, supersession, and archival history |
| Retrieval | Ranked recall, semantic search over embedded facts and documents, N-hop graph traversal, related tasks/events, and bitemporal `asOf` queries |
| Ingestion | Plain text, email, and calendar signal adapters; deterministic participant seeding; LLM extraction; entity resolution; and custom source/extractor interfaces |
| Learning | Incremental user-profile generation, optional organization profiles, background conversation ingestion, and per-user-per-agent behavior rules |
| Storage and scale | Zero-dependency in-memory storage plus Mongo adapters, native `$graphLookup`, Atlas Vector Search, index helpers, and pluggable `IMemoryStore` backends |
| Security | Required ownership, owner/group/world permissions, optional principal ACLs, storage-level read filtering, write authorization, and LLM-safe scoped tools |

Use it in three ways:

1. **Directly** through `MemorySystem` in a server, worker, migration, or any
   non-agent application.
2. **Inside an agent** with `MemoryPluginNextGen` (six read tools and profile
   injection) plus the optional `MemoryWritePluginNextGen` (six write tools).
3. **As an ingestion pipeline** with `SignalIngestor` or
   `SessionIngestorPluginNextGen`, including retrieval-only agents that learn
   in the background without giving the LLM write access.

Start with the **[Memory Layer Guide](./docs/MEMORY_GUIDE.md)**. The specialist
docs cover the [API](./docs/MEMORY_API.md),
[permissions](./docs/MEMORY_PERMISSIONS.md),
[predicate vocabulary](./docs/MEMORY_PREDICATES.md), and
[signal ingestion](./docs/MEMORY_SIGNALS.md).

## Context plugins and tools are modular by design

`AgentContextNextGen` is the runtime composition layer around an agent. Its
goal is to let each capability own its instructions, context content, tools,
token accounting, compaction behavior, and persisted state while the context
manager assembles one coherent model input. Compaction happens once before the
LLM call, tool-call/result pairs stay together, and disabled features add no
tools or prompt content.

| Context feature | Purpose |
|-----------------|---------|
| Working memory | External, tiered scratch storage for raw notes, summaries, and findings |
| In-context memory | Small high-value state kept directly in the prompt—no retrieval call required |
| Self-learning memory | Profiles, graph/vector retrieval, document search, and optional controlled writes through `memory_*` tools |
| Tool catalog | Lets agents discover and load only the tool categories needed for the current task |
| Shared workspace | Versioned coordination board for multi-agent teams |
| Persistent instructions / user info | Backward-compatible stores; new applications should generally prefer the self-learning memory system |

Tools reach an agent from four explicit sources: application-supplied
`ToolFunction`s, the 39 generated built-ins, feature plugins (`store_*`,
`memory_*`, catalog tools, and others), and connector-generated tools.
`ConnectorTools.for(name)` always adds a protected authenticated API tool when
the connector has a `baseURL`, then adds a specialized pack where OneRingAI has
one—for example Slack, GitHub, Microsoft, Google Workspace, Telegram, Twilio,
Zoom, web search/scraping, and AI media connectors. Generated names are
connector-prefixed, so multiple accounts and vendors can coexist safely.

See the **[Connector & Tool Catalog](./docs/CONNECTOR_TOOL_CATALOG.md)** for the
complete 50-template matrix, every first-party specialized pack, and discovery
APIs. The [Context Management guide](./USER_GUIDE.md#context-management) covers
plugin lifecycle, stores, compaction, persistence, and custom plugins.

## Table of Contents

- [What's new in 1.2.0](#whats-new-in-120)
- [Built for coding agents](#built-for-coding-agents)
- [Agent Runtime: run complete agents through one API](#agent-runtime-run-complete-agents-through-one-api)
- [Meet AMOS: a terminal agent built with OneRingAI](#meet-amos-a-terminal-agent-built-with-oneringai)
- [Memory is a first-class subsystem](#memory-is-a-first-class-subsystem)
- [Context plugins and tools are modular by design](#context-plugins-and-tools-are-modular-by-design)
- [Features](#features)
- [Quick Start](#quick-start) — Installation, basic usage, tools, vision, audio, images, video, search, scraping
- [Supported Providers](#supported-providers)
- [Key Features](#key-features)
  - [1. Agent with Plugins](#1-agent-with-plugins)
  - [2. Dynamic Tool Management](#2-dynamic-tool-management)
  - [3. Tool Execution Plugins](#3-tool-execution-plugins)
  - [4. Tool Permissions](#4-tool-permissions)
  - [5. Session Persistence](#5-session-persistence)
  - [Storage Registry](#storage-registry)
  - [6. Working Memory](#6-working-memory)
  - [7. Research with Search Tools](#7-research-with-search-tools)
  - [8. Context Management](#8-context-management)
  - [9. InContextMemory](#9-incontextmemory)
  - [10. Persistent Instructions](#10-persistent-instructions)
  - [11. User Info](#11-user-info)
  - [Self-Learning Memory — plugin + tools](#self-learning-memory--plugin--tools) — `MemoryPluginNextGen` + `MemoryWritePluginNextGen` with **12 `memory_*` LLM tools** (6 read incl. `memory_search_documents` + 6 write incl. `memory_set_agent_rule`)
  - [12. Direct LLM Access](#12-direct-llm-access)
  - [Advanced Inference](#advanced-inference-caching-batches-and-provider-hosted-tools) — Prompt caching, async batches, provider-hosted tools, telemetry, and data policy
  - [13. Audio Capabilities](#13-audio-capabilities)
  - [Embeddings](#embeddings) — Multi-vendor text and multimodal embeddings with MRL dimension control
  - [14. Model Registry](#14-model-registry)
  - [15. Streaming](#15-streaming)
  - [16. OAuth for External APIs](#16-oauth-for-external-apis)
  - [17. Developer Tools](#17-developer-tools)
  - [18. Custom Tool Generation](#18-custom-tool-generation) — Agents create, test, and persist their own tools
  - [19. Desktop Automation Tools](#19-desktop-automation-tools) — Screenshot, mouse, keyboard, window control for computer use agents
  - [20. Document Reader](#20-document-reader) — PDF, DOCX, XLSX, PPTX, CSV, HTML, images
  - [21. Routine Execution](#21-routine-execution) — Multi-step workflows with task dependencies, validation, and memory bridging
  - [22. External API Integration](#22-external-api-integration) — Scoped Registry, Vendor Templates, Tool Discovery
  - [23. Microsoft Graph Connector Tools](#23-microsoft-graph-connector-tools) — Email, calendar, meetings, and Teams transcripts
  - [24. Tool Catalog](#24-tool-catalog) — Dynamic discovery and loading for large tool sets
  - [25. Async (Non-Blocking) Tools](#25-async-non-blocking-tools) — Background tool execution with auto-continuation
  - [26. Long-Running Sessions (Suspend/Resume)](#26-long-running-sessions-suspendresume) — Suspend agent loops waiting for external input, resume days later
  - [27. Agent Registry](#27-agent-registry) — Global tracking, deep inspection, parent/child hierarchy, event fan-in, external control
  - [28. Agent Orchestrator](#28-agent-orchestrator) — Multi-agent teams with shared workspace, delegation, and async execution
  - [29. Telegram Connector Tools](#29-telegram-connector-tools) — Bot API tools for messaging, updates, and webhooks
  - [30. Twilio Connector Tools](#30-twilio-connector-tools) — SMS and WhatsApp messaging tools
  - [31. Google Workspace Connector Tools](#31-google-workspace-connector-tools) — Gmail, Calendar, Meet, and Drive tools
  - [32. Zoom Connector Tools](#32-zoom-connector-tools) — Meeting management and transcripts
  - [33. Unified Calendar](#33-unified-calendar) — Cross-provider meeting slot finder (Google + Microsoft)
  - [34. Multi-Account Connectors](#34-multi-account-connectors) — Multiple accounts per vendor with automatic routing
  - [35. Integration Testing](#35-integration-testing) — Reusable test suites for connector tools
  - [36. Instruction Templates](#36-instruction-templates) — `{{DATE}}`, `{{AGENT_ID}}`, custom `{{COMMAND:arg}}` with extensible registry
- [MCP Integration](#mcp-model-context-protocol-integration)
- [Documentation](#documentation)
- [Examples](#examples)
- [Development](#development)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

<!-- For in-depth guides and full API reference, see the docs section below -->

## Documentation

> **Start here if you're looking for detailed docs or the full API reference.**

| Document | Description |
|----------|-------------|
| **[Agent Guide](./AGENTS.md)** | Canonical context file for Codex, Claude Code, and custom coding agents: architecture, recipes, capability routing, safety invariants, and documentation map |
| **[Agent Runtime Guide](./USER_GUIDE.md#agent-runtime-preview)** | Detailed usage guide for interchangeable OneRingAI/Codex agents, model and reasoning controls, live observation, capabilities, policy, lifecycle, and cleanup |
| **[Agent Runtime Design](./docs/designs/AGENT_RUNTIME.md)** | Implemented local preview for OneRingAI and Codex SDK agents: generic model/reasoning controls, live observable autonomous runs, capabilities, policy, and the isolated-server roadmap |
| **[User Guide](./USER_GUIDE.md)** | Comprehensive guide covering every feature with examples — connectors, agents, context, plugins, audio, video, search, MCP, OAuth, and more |
| **[API Reference](./API_REFERENCE.md)** | Auto-generated reference for all public exports — classes, interfaces, types, and functions with signatures |
| **[Memory Layer Guide](./docs/MEMORY_GUIDE.md)** | Standalone entity/fact memory system: graph and vector retrieval, ingestion, resolution, profiles, adapters, scaling, and agent integration |
| **[Memory API & Security](./docs/MEMORY_API.md)** | Complete `MemorySystem` API, with dedicated [permissions](./docs/MEMORY_PERMISSIONS.md), [predicates](./docs/MEMORY_PREDICATES.md), and [signals](./docs/MEMORY_SIGNALS.md) guides |
| **[Connector & Tool Catalog](./docs/CONNECTOR_TOOL_CATALOG.md)** | All 50 connector templates, generic authenticated API behavior, specialized tool packs, built-ins, plugin tools, and discovery APIs |
| **[Runnable Examples](https://github.com/aantich/oneringai/blob/main/examples/README.md)** | Every example program, what it demonstrates, required credentials, side effects, and exact run command |
| **[1.0.0 Upgrade Guide](./USER_GUIDE.md#upgrading-to-100)** | Breaking changes, compatibility guarantees, migration checklist, and before/after examples |
| [Model Registry Audit](./docs/MODEL_REGISTRY_AUDIT.md) | Vendor-by-vendor gaps, implemented status, model snapshot, API boundaries, and official sources |
| [CHANGELOG](./CHANGELOG.md#100--2026-08-08) | Full 1.0.0 release notes, breaking changes, validation, and version history |

---

## Tutorial / Architecture Series

**Part 0**. [One Lib to Rule Them All: Why We Built OneRingAI](https://medium.com/superstringtheory/one-library-to-rule-them-all-why-we-built-oneringai-689f904874d6): introduction and architecture overview

**Part 1**. [Your AI Agent Forgets Everything. Here’s How We Fixed It.](https://medium.com/superstringtheory/your-ai-agent-forgets-everything-heres-how-we-fixed-it-276b39aedbb3): context management plugins


## YOUetal

Showcasing another amazing "built with oneringai": ["no saas" agentic business team](https://youetal.ai)

## Features

- ✨ **Unified API** - One interface for 12 AI providers (OpenAI, Anthropic, Google, Vertex, Groq, Together, Perplexity, Grok, DeepSeek, Mistral, Ollama, Custom)
- 🧩 **[Agent Runtime preview](./USER_GUIDE.md#agent-runtime-preview)** - Plug-compatible OneRingAI/Codex agent drivers with model and thinking selection, live reasoning/activity events, and capability-gated future interaction
- 🔑 **Connector-First Architecture** - Single auth system with support for multiple keys per vendor
- 📊 **Model Registry v2** - Lifecycle, aliases, endpoints, official sources, and modality-aware pricing for current text/realtime models plus dedicated image, video, voice, STT, and embedding registries
- 🎤 **Audio Capabilities** - Text-to-Speech and Speech-to-Text with OpenAI, Google, and xAI, including xAI WebSocket streaming
- ☎️ **[OpenAI Realtime API](./USER_GUIDE.md#openai-realtime-api)** - GA voice agents, live transcription, and speech translation over WebSocket/WebRTC, plus SIP call control, tools, VAD, and Twilio bridging
- 🧭 **[GPT-6 Astra Responses extensions](./USER_GUIDE.md#gpt-6-astra-responses-extensions)** - Async tools, WebSocket steering, persistent reasoning/compaction state, safety alerts, Decisions, GPT-Live, and custom voices
- 📞 **[xAI Voice Agent API](./USER_GUIDE.md#xai-realtime-voice-agent-api)** - JSON or binary audio, browser credentials, conversation resumption, reasoning controls, and SIP refer/hangup
- 🖼️ **Image Generation** - GPT Image 2.5 Sunburst/Flare, Gemini Nano Banana 2.1, Imagen, and Grok Imagine generation/editing
- 🎬 **Video Generation** - Callable OpenAI Sora 2 (with published retirement metadata), Google Veo/Omni, and Grok Imagine Video 1.5
- 🔢 **Embeddings** - Text and multimodal embedding generation, including Gemini Embedding 2 for text, image, audio, video, and documents
- 🔍 **Web Search** - Connector-based search with Serper, Brave, Tavily, and RapidAPI providers
- 🔌 **NextGen Context** - Clean, plugin-based context management with `AgentContextNextGen`
- 🎛️ **Dynamic Tool Management** - Enable/disable tools at runtime, namespaces, priority-based selection
- 🔌 **Tool Execution Plugins** - Pluggable pipeline for logging, analytics, UI updates, custom behavior
- 💾 **Session Persistence** - Save and resume conversations with full state restoration
- ⏸️ **Long-Running Sessions** - Suspend agent loops via `SuspendSignal`, resume hours/days later with `Agent.hydrate()`
- 👤 **Multi-User Support** - Set `userId` once, flows automatically to all tool executions and session metadata
- 🔒 **Auth Identities** - Restrict agents to specific connectors (and accounts), composable with access policies
- 🤖 **Universal Agent** - ⚠️ *Deprecated* - Use `Agent` with plugins instead
- 🤖 **Task Agents** - ⚠️ *Deprecated* - Use `Agent` with `WorkingMemoryPluginNextGen`
- 🔬 **Research Agent** - ⚠️ *Deprecated* - Use `Agent` with search tools
- 🎯 **Context Management** - Algorithmic compaction with tool-result-to-memory offloading
- 📌 **InContextMemory** - Live key-value storage directly in LLM context with optional UI display (`showInUI`)
- 📝 **Persistent Instructions** - ⚠️ *Deprecated* in favour of `MemoryPluginNextGen` (self-learning memory). Still works unchanged.
- 👤 **User Info Plugin** - ⚠️ *Deprecated* in favour of `MemoryPluginNextGen`. Still works unchanged.
- 🧠 **Self-Learning Memory** - `MemoryPluginNextGen` + `MemoryWritePluginNextGen` + 12 `memory_*` tools — brain-like entity/fact store with three-principal permissions, semantic search, graph queries, LLM-synthesised profiles that evolve from observations, user-driven behavior rules, optional background ingestion via `SessionIngestorPluginNextGen`
- 🛠️ **Agentic Workflows** - Built-in tool calling and multi-turn conversations
- 🔧 **Developer Tools** - Filesystem and shell tools for coding assistants (read, write, edit, grep, glob, bash)
- 🧰 **Custom Tool Generation** - Let agents create, test, and persist their own reusable tools at runtime — complete meta-tool system with VM sandbox
- 🖥️ **Desktop Automation** - OS-level computer use — screenshot, mouse, keyboard, and window control for vision-driven agent loops
- 📄 **Document Reader** - Universal file-to-text converter — PDF, DOCX, XLSX, PPTX, CSV, HTML, images auto-converted to markdown
- 🔌 **MCP Integration** - Model Context Protocol client for seamless tool discovery from local and remote servers
- 👁️ **Vision Support** - Analyze images with AI across all providers
- 📋 **Clipboard Integration** - Paste screenshots directly (like Claude Code!)
- 🔐 **Scoped Connector Registry** - Pluggable access control for multi-tenant connector isolation
- 💾 **StorageRegistry** - Centralized storage configuration — swap all backends (sessions, media, custom tools, etc.) with one `configure()` call
- 🔐 **OAuth 2.0** - Full OAuth support for external APIs with encrypted token storage
- 📦 **Vendor Templates** - Pre-configured auth templates for 50 services (GitHub, Slack, Stripe, etc.)
- 📧 **Microsoft Graph Tools** - Email, calendar, meetings, and Teams transcripts via Microsoft Graph API
- 🔁 **Routine Execution** - Multi-step workflows with task dependencies, LLM validation, retry logic, and memory bridging between tasks
- 📊 **Execution Recording** - Persist full routine execution history with `createExecutionRecorder()` — replaces manual hook wiring
- ⏰ **Scheduling & Triggers** - `SimpleScheduler` for interval/one-time schedules, `EventEmitterTrigger` for webhook/queue-driven execution
- 📦 **Tool Catalog** - Dynamic tool loading/unloading — agents discover and load only the categories they need at runtime
- **Async Tools** - Non-blocking tool execution — long-running tools run in background while the agent continues reasoning, with auto-continuation when results arrive
- 📡 **Agent Registry** - Global tracking of all active agents — deep inspection, parent/child hierarchy, event fan-in, external control
- 📱 **Telegram Tools** - 6 Telegram Bot API tools — send messages/photos, get updates, webhooks, chat info
- 📞 **Twilio Tools** - 4 Twilio tools — SMS, WhatsApp messaging, message listing and details
- 📧 **Google Workspace Tools** - 11 tools for Gmail, Calendar, Meet transcripts, and Drive (read, search, list files)
- 🎥 **Zoom Tools** - 3 Zoom tools — create/update meetings, get cloud recording transcripts
- 📅 **Unified Calendar** - Cross-provider meeting slot finder aggregating Google + Microsoft calendars
- 👥 **Multi-Account Connectors** - Multiple accounts per vendor (e.g., work + personal) with automatic routing
- 🧪 **Integration Testing** - Reusable test suite framework for connector tools with 10 built-in suites
- 📝 **Instruction Templates** - `{{DATE}}`, `{{AGENT_ID}}`, `{{RANDOM:1:10}}` and custom `{{COMMAND:arg}}` in agent instructions — extensible registry with async support
- 🔄 **Streaming** - Real-time responses with event streams
- ⚡ **Advanced Inference** - Provider-aware prompt caching, asynchronous text batches, provider-hosted tools, detailed usage telemetry, and explicit data-handling policy
- 📝 **TypeScript** - Full type safety and IntelliSense support

> **Multi-User Support:** Set `userId` once on an agent and it automatically flows to all tool executions, OAuth token retrieval, session metadata, and connector scoping. Combine with `identities` and access policies for complete multi-tenant isolation. See [Multi-User Support](./USER_GUIDE.md#multi-user-support-userid) and [Auth Identities](./USER_GUIDE.md#auth-identities-identities) in the User Guide.

## Quick Start

### Installation

```bash
npm install @everworker/oneringai
```

### Basic Usage

```typescript
import { Connector, Agent, Vendor } from '@everworker/oneringai';

// 1. Create a connector (authentication)
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// 2. Create an agent
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-5.6-terra',
});

// 3. Run
const response = await agent.run('What is the capital of France?');
console.log(response.output_text);
// Output: "The capital of France is Paris."
```

### With Tools

```typescript
import { ToolFunction } from '@everworker/oneringai';

const weatherTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
      },
    },
  },
  execute: async (args) => {
    return { temp: 72, location: args.location };
  },
};

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-5.6-terra',
  tools: [weatherTool],
});

await agent.run('What is the weather in Paris?');
```

### Vision

```typescript
import { createMessageWithImages } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-5.6-terra',
});

const response = await agent.run(
  createMessageWithImages('What is in this image?', ['./photo.jpg'])
);
```

### Audio

```typescript
import { TextToSpeech, SpeechToText } from '@everworker/oneringai';

// Text-to-Speech — built-in voice
const tts = TextToSpeech.create({
  connector: 'openai',
  model: 'tts-1-hd',
  voice: 'nova', // alloy | ash | ballad | coral | echo | fable | onyx | nova | sage | shimmer | verse | marin | cedar
});

await tts.toFile('Hello, world!', './output.mp3');

// Text-to-Speech — custom voice (OpenAI). Pass the `voice_…` id you got
// when registering the voice in the OpenAI dashboard; the SDK call is
// handled automatically.
const customTts = TextToSpeech.create({
  connector: 'openai',
  model: 'gpt-4o-mini-tts',
  voice: 'voice_1234abcd',
});
await customTts.toFile('Spoken in your bespoke voice.', './brand.mp3');

// Speech-to-Text
const stt = SpeechToText.create({
  connector: 'openai',
  model: 'gpt-transcribe',
});

const result = await stt.transcribeFile('./audio.mp3');
console.log(result.text);

// Headerless raw telephony PCM must identify its wire format.
const phoneResult = await stt.transcribe(pcm16le8kBuffer, {
  encoding: 'pcm',
  sampleRate: 8000,
});
```

### Image Generation

```typescript
import { ImageGeneration } from '@everworker/oneringai';

// OpenAI GPT Image
const imageGen = ImageGeneration.create({ connector: 'openai' });

const result = await imageGen.generate({
  prompt: 'A futuristic city at sunset',
  model: 'gpt-image-2.5-sunburst',
  size: '1024x1024',
  quality: 'high',
});

// Save to file
const buffer = Buffer.from(result.data[0].b64_json!, 'base64');
await fs.writeFile('./output.png', buffer);

// Google Gemini native image
const googleGen = ImageGeneration.create({ connector: 'google' });

const googleResult = await googleGen.generate({
  prompt: 'A colorful butterfly in a garden',
  model: 'gemini-nano-banana-2.1',
  size: '2048x2048',
  aspectRatio: '16:9',
  n: 2,
});
```

### Video Generation

```typescript
import { VideoGeneration } from '@everworker/oneringai';

// OpenAI Sora (deprecated; callable until the Videos API shuts down 2026-09-24)
const videoGen = VideoGeneration.create({ connector: 'openai' });

// Start video generation (async - returns a job)
const job = await videoGen.generate({
  prompt: 'A cinematic shot of a sunrise over mountains',
  model: 'sora-2',
  duration: 8,
  resolution: '1280x720',           // 720x1280 / 1280x720 / 1024x1792 / 1792x1024 (1.4× HD)
});

// Wait for completion
const result = await videoGen.waitForCompletion(job.jobId);

// Download the video
const videoBuffer = await videoGen.download(job.jobId);
await fs.writeFile('./output.mp4', videoBuffer);

// Google Veo
const googleVideo = VideoGeneration.create({ connector: 'google' });

const veoJob = await googleVideo.generate({
  prompt: 'A butterfly flying through a garden',
  model: 'veo-3.1-lite-generate-preview',
  duration: 8,
});
```

Sora 2/2 Pro are still callable but have published deprecation and retirement
metadata. Production pickers should show `lifecycle` and `retirementDate`, not
infer recommendation from `isActive` alone. Google Veo/Omni and xAI Grok
Imagine Video 1.5 are covered in the [User Guide](./USER_GUIDE.md#video-generation).

#### Sora: extend, remix, edit (OpenAI only)

The Videos API references completed clips by **id** — pass the `jobId` returned
by `generate()`, not a buffer or URL.

```typescript
// Extend — generate an additional segment after the source clip.
const extension = await videoGen.extend({
  video: job.jobId,           // id of a completed video
  prompt: 'The camera pulls back to reveal a snow-covered valley',
  extendDuration: 8,          // length of the *new* segment, snapped to 4/8/12
});

// Remix — same length, prompt-steered re-generation.
const remix = await videoGen.remix({
  videoId: job.jobId,
  prompt: 'Same composition, but at golden hour',
});

// Edit — apply a prompt-described change to a completed clip.
const edited = await videoGen.edit({
  videoId: job.jobId,
  prompt: 'Add light snowfall throughout',
});
```

#### Sora: reusable characters (OpenAI only)

Upload a reference video to register a character. Note: the unified `generate()`
does not yet apply the character id — reference the character in your prompt and
use `getCharacter()` to look it up.

```typescript
const character = await videoGen.createCharacter({
  name: 'Hero',
  video: './reference-shot.mp4', // Buffer | local path | URL
});
// → { id: 'char_…', name: 'Hero' }

const scene = await videoGen.generate({
  prompt: 'Hero walks across a windswept beach at dusk',
});

// Look up later
const same = await videoGen.getCharacter(character.id);
```

### Embeddings

```typescript
import { Embeddings } from '@everworker/oneringai';

// OpenAI embeddings
const embeddings = Embeddings.create({ connector: 'openai' });

const result = await embeddings.embed(['Hello world', 'How are you?'], {
  model: 'text-embedding-3-small',
  dimensions: 512,  // MRL: reduce dimensions for faster search
});

console.log(result.embeddings.length);     // 2
console.log(result.embeddings[0].length);  // 512

// Ollama (local, free)
const local = Embeddings.create({ connector: 'ollama-local' });
const localResult = await local.embed('search query');
// Uses embeddinggemma by default (compact, multilingual, 768 dims)
```

### Document Reader

Read any document format — agents automatically get markdown text from PDFs, Word docs, spreadsheets, and more:

```typescript
import { Agent, developerTools } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: developerTools,
});

// read_file auto-converts binary documents to markdown
await agent.run('Read /path/to/report.pdf and summarize the key findings');
await agent.run('Read /path/to/data.xlsx and describe the trends');
await agent.run('Read /path/to/presentation.pptx and list all slides');
```

**Programmatic usage:**

```typescript
import { DocumentReader, readDocumentAsContent } from '@everworker/oneringai';

// Read any file to markdown pieces
const reader = DocumentReader.create();
const result = await reader.read('/path/to/report.pdf');
console.log(result.pieces); // DocumentPiece[] (text + images)

// One-call conversion to LLM Content[] (for multimodal input)
const content = await readDocumentAsContent('/path/to/slides.pptx', {
  imageFilter: { minWidth: 100, minHeight: 100 },
  imageDetail: 'auto',
});

const response = await agent.run([
  { type: 'input_text', text: 'Analyze this document:' },
  ...content,
]);
```

**Supported Formats:**
- **Office**: DOCX, PPTX, ODT, ODP, ODS, RTF (via `officeparser`)
- **Spreadsheets**: XLSX, CSV (via `exceljs`)
- **PDF** (via `unpdf`)
- **HTML** (via Readability + Turndown)
- **Text**: TXT, MD, JSON, XML, YAML
- **Images**: PNG, JPG, GIF, WEBP, SVG (pass-through as base64)

### Web Search

Connector-based web search with multiple providers:

```typescript
import { Connector, SearchProvider, ConnectorTools, Services, Agent, tools } from '@everworker/oneringai';

// Create search connector
Connector.create({
  name: 'serper-main',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

// Option 1: Use SearchProvider directly
const search = SearchProvider.create({ connector: 'serper-main' });
const results = await search.search('latest AI developments 2026', {
  numResults: 10,
  country: 'us',
  language: 'en',
});

// Option 2: Use with Agent via ConnectorTools
const searchTools = ConnectorTools.for('serper-main');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [...searchTools, tools.webFetch],
});

await agent.run('Search for quantum computing news and summarize');
```

**Supported Search Providers:**
- **Serper** - Google search via Serper.dev (2,500 free queries)
- **Brave** - Independent search index (privacy-focused)
- **Tavily** - AI-optimized search with summaries
- **RapidAPI** - Real-time web search (various pricing)

### Web Scraping

Enterprise web scraping with automatic fallback and bot protection bypass:

```typescript
import { Connector, ScrapeProvider, ConnectorTools, Services, Agent, tools } from '@everworker/oneringai';

// Create ZenRows connector for bot-protected sites
Connector.create({
  name: 'zenrows',
  serviceType: Services.Zenrows,
  auth: { type: 'api_key', apiKey: process.env.ZENROWS_API_KEY! },
  baseURL: 'https://api.zenrows.com/v1',
});

// Option 1: Use ScrapeProvider directly
const scraper = ScrapeProvider.create({ connector: 'zenrows' });
const result = await scraper.scrape('https://protected-site.com', {
  includeMarkdown: true,
  vendorOptions: {
    jsRender: true,        // JavaScript rendering
    premiumProxy: true,    // Residential IPs
  },
});

// Option 2: Use web_scrape tool with Agent via ConnectorTools
const scrapeTools = ConnectorTools.for('zenrows');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [...scrapeTools, tools.webFetch],
});

// web_scrape auto-falls back: native → API
await agent.run('Scrape https://example.com and summarize');
```

**Supported Scrape Providers:**
- **ZenRows** - Enterprise scraping with JS rendering, residential proxies, anti-bot bypass
- **Jina Reader** - Clean content extraction with AI-powered readability
- **Firecrawl** - Web scraping with JavaScript rendering
- **ScrapingBee** - Headless browser scraping with proxy rotation

## Supported Providers

| Provider | Text | Vision | TTS | STT | Image | Video | Tools | Context |
|----------|------|--------|-----|-----|-------|-------|-------|---------|
| **OpenAI** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1.05M |
| **Anthropic (Claude)** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | 1M |
| **Google (Gemini)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1M |
| **Google Vertex AI** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | 1M |
| **Grok (xAI)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 1M |
| **Groq** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | 128K |
| **Together AI** | ✅ | Some | ❌ | ❌ | ❌ | ❌ | ✅ | 128K |
| **DeepSeek** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | 1M |
| **Mistral** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | 32K |
| **Perplexity** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | 128K |
| **Ollama** | ✅ | Varies | ❌ | ❌ | ❌ | ❌ | ✅ | Varies |
| **Custom** | ✅ | Varies | ❌ | ❌ | ❌ | ❌ | ✅ | Varies |

DeepSeek has a dedicated adapter rather than the generic OpenAI path. It
supports Chat Completions, Responses, streaming, reasoning replay across tool
turns, JSON/JSON Schema where the selected transport supports it, model
listing, connector-backed FIM/balance access, and first-party native web search. The connector
can target the official API or a known hosted endpoint:

```typescript
import { Agent, Connector, Vendor } from '@everworker/oneringai';

Connector.create({
  name: 'deepseek-openrouter',
  vendor: Vendor.DeepSeek,
  auth: { type: 'api_key', apiKey: process.env.OPENROUTER_API_KEY! },
  options: { deepseekHost: 'openrouter' },
});

const agent = Agent.create({
  connector: 'deepseek-openrouter',
  model: 'deepseek-v4-pro', // mapped to the host's model ID
});
```

Built-in hosts are `official`, `openrouter`, `together`, `fireworks`,
`deepinfra`, `nvidia-nim`, and `azure-foundry`. Use `custom` plus an explicit
`baseURL` for another OpenAI-compatible deployment. Host-specific model IDs and
limits are resolved separately from the canonical DeepSeek model registry.

## Key Features

### 1. Agent with Plugins

The **Agent** class is the primary agent type, supporting all features through composable plugins:

```typescript
import { Agent, createFileContextStorage } from '@everworker/oneringai';

// Create storage for session persistence
const storage = createFileContextStorage('my-assistant');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'user-123',            // Flows to all tool executions automatically
  identities: [                   // Only these connectors visible to tools
    { connector: 'github' },
    { connector: 'slack' },
  ],
  tools: [weatherTool, emailTool],
  context: {
    features: {
      workingMemory: true,      // Store/retrieve data across turns
      inContextMemory: true,    // Key-value pairs directly in context
      persistentInstructions: true,  // Agent instructions that persist to disk
    },
    agentId: 'my-assistant',
    storage,
  },
});

// Run the agent
const response = await agent.run('Check weather and email me the report');
console.log(response.output_text);

// Save session for later
await agent.context.save('session-001');
```

**Features:**
- 🔧 **Plugin Architecture** - Enable/disable features via `context.features`
- 💾 **Session Persistence** - Save/load full state with `ctx.save()` and `ctx.load()`
- 📝 **Working Memory** - Store findings with automatic eviction
- 📌 **InContextMemory** - Key-value pairs visible directly to LLM
- 🔄 **Persistent Instructions** - Agent instructions that persist across sessions

### 2. Dynamic Tool Management

Control tools at runtime. **AgentContextNextGen is the single source of truth** - `agent.tools` and `agent.context.tools` are the same ToolManager instance:

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool, emailTool, databaseTool],
});

// Disable tool temporarily
agent.tools.disable('database_tool');

// Enable later
agent.tools.enable('database_tool');

// UNIFIED ACCESS: Both paths access the same ToolManager
console.log(agent.tools === agent.context.tools);  // true

// Changes via either path are immediately reflected
agent.context.tools.disable('email_tool');
console.log(agent.tools.listEnabled().includes('email_tool'));  // false

// Context-aware selection
const selected = agent.tools.selectForContext({
  mode: 'interactive',
  currentTask: 'send-invoice',
});

// Backward compatible
agent.addTool(newTool);        // Still works!
agent.removeTool('old_tool');  // Still works!
```

### 3. Tool Execution Plugins

Extend tool execution with custom behavior through a pluggable pipeline architecture. Add logging, analytics, UI updates, permission prompts, or any custom logic:

```typescript
import { Agent, LoggingPlugin, type IToolExecutionPlugin } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool],
});

// Add built-in logging plugin
agent.tools.executionPipeline.use(new LoggingPlugin());

// Create a custom plugin
const analyticsPlugin: IToolExecutionPlugin = {
  name: 'analytics',
  priority: 100,

  async beforeExecute(ctx) {
    console.log(`Starting ${ctx.toolName}`);
  },

  async afterExecute(ctx, result) {
    const duration = Date.now() - ctx.startTime;
    trackToolUsage(ctx.toolName, duration);
    return result; // Must return result (can transform it)
  },

  async onError(ctx, error) {
    reportError(ctx.toolName, error);
    return undefined; // Let error propagate (or return value to recover)
  },
};

agent.tools.executionPipeline.use(analyticsPlugin);
```

**Plugin Lifecycle:**
1. `beforeExecute` - Modify args, abort execution, or pass through
2. Tool execution
3. `afterExecute` - Transform results (runs in reverse priority order)
4. `onError` - Handle/recover from errors

**Plugin Context (`PluginExecutionContext`):**
```typescript
interface PluginExecutionContext {
  toolName: string;           // Name of the tool being executed
  args: unknown;              // Original arguments (read-only)
  mutableArgs: unknown;       // Modifiable arguments
  metadata: Map<string, unknown>; // Share data between plugins
  startTime: number;          // Execution start timestamp
  tool: ToolFunction;         // The tool being executed
  executionId: string;        // Unique ID for this execution
}
```

**Built-in Plugins:**
- `LoggingPlugin` - Logs tool execution with timing and result summaries

**Pipeline Management:**
```typescript
// Add plugin
agent.tools.executionPipeline.use(myPlugin);

// Remove plugin
agent.tools.executionPipeline.remove('plugin-name');

// Check if registered
agent.tools.executionPipeline.has('plugin-name');

// Get plugin
const plugin = agent.tools.executionPipeline.get('plugin-name');

// List all plugins
const plugins = agent.tools.executionPipeline.list();
```

### 4. Tool Permissions

Policy-based permission system with per-user rules, argument inspection, and pluggable storage. Permissions are enforced at the ToolManager pipeline level -- **all tool execution paths are gated**.

#### Zero-Config (Backward Compatible)

Existing code works unchanged. Tools that declare `scope: 'always'` (including
the built-in read-only filesystem tools) execute immediately. Tools declaring
`'session'` or `'once'` use the approval flow; without an
`onApprovalRequired` callback they are denied rather than silently allowed:

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [readFile, bash],
  permissions: {
    onApprovalRequired: async (ctx) => showApprovalDialog(ctx),
  },
});

// read_file executes immediately (in DEFAULT_ALLOWLIST)
// bash triggers approval flow (write/shell tools require approval by default)
```

#### Per-User Permission Rules

User rules have the **highest priority** -- they override all built-in policies. Rules support argument inspection with conditions:

```typescript
import { PermissionPolicyManager } from '@everworker/oneringai';

const manager = new PermissionPolicyManager();

// Allow bash, but only in the project directory
await manager.userRules.addRule({
  id: '1', toolName: 'bash', action: 'allow', enabled: true,
  createdBy: 'user', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  conditions: [{ argName: 'command', operator: 'not_contains', value: 'rm -rf' }],
});

// Block all web tools unconditionally
await manager.userRules.addRule({
  id: '2', toolName: 'web_fetch', action: 'deny', enabled: true, unconditional: true,
  createdBy: 'admin', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
```

Condition operators: `starts_with`, `not_starts_with`, `contains`, `not_contains`, `equals`, `not_equals`, `matches` (regex), `not_matches`.

#### Policy Model

OneRingAI evaluates composable policies in priority order (`deny`
short-circuits). The package root exports `IPermissionPolicy`,
`PermissionPolicyManager`, user-rule storage, and the legacy-compatible
allowlist/blocklist configuration. The source tree also contains the following
internal policy implementations:

| Policy | Description |
|--------|-------------|
| **AllowlistPolicy** | Auto-allow tools in the allowlist (read-only, memory, catalog) |
| **BlocklistPolicy** | Hard-block tools in the blocklist (no approval possible) |
| **SessionApprovalPolicy** | Cache approvals per-session with optional argument-scoped keys |
| **PathRestrictionPolicy** | Restrict file tools to allowed directory roots |
| **BashFilterPolicy** | Block/flag dangerous shell commands by pattern |
| **UrlAllowlistPolicy** | Restrict web tools to allowed URL domains |
| **RolePolicy** | Role-based access control (map user roles to tool permissions) |
| **RateLimitPolicy** | Limit tool invocations per time window |

The concrete classes in that table are not package-root exports in 1.0.0. Use
the public allowlist/blocklist options, or implement `IPermissionPolicy`:

```typescript
import type { IPermissionPolicy } from '@everworker/oneringai';

const noPrivilegedShell: IPermissionPolicy = {
  name: 'app:no-privileged-shell',
  priority: 50,
  evaluate(ctx) {
    const command = String(ctx.args.command ?? '');
    return ctx.toolName === 'bash' && /\b(?:sudo|rm\s+-rf)\b/.test(command)
      ? {
          verdict: 'deny',
          reason: 'Privileged and recursive-delete commands are blocked',
          policyName: 'app:no-privileged-shell',
        }
      : {
          verdict: 'abstain',
          reason: 'Not applicable',
          policyName: 'app:no-privileged-shell',
        };
  },
};

const agent = Agent.create({
  connector: 'openai', model: 'gpt-4.1',
  permissions: {
    policies: [noPrivilegedShell],
  },
});
```

#### Approval Dialog Integration

When a tool needs approval, the `onApprovalRequired` callback fires. Return a `createRule` to persist the decision:

```typescript
const agent = Agent.create({
  connector: 'openai', model: 'gpt-4.1',
  permissions: {
    onApprovalRequired: async (ctx) => {
      const userChoice = await showApprovalDialog(ctx.toolName, ctx.args);

      return {
        approved: userChoice.allow,
        // Persist as a user rule so it won't ask again
        createRule: userChoice.remember ? {
          description: `Auto-allow ${ctx.toolName}`,
          conditions: [{ argName: 'path', operator: 'starts_with', value: '/workspace' }],
        } : undefined,
      };
    },
  },
});
```

#### Tool Self-Declaration

Tool authors declare permission defaults on the tool definition. App developers can override at registration:

```typescript
const myTool: ToolFunction = {
  definition: { type: 'function', function: { name: 'deploy', description: '...', parameters: {} } },
  execute: async (args) => { /* ... */ },
  // Author-declared defaults
  permission: {
    scope: 'once',
    riskLevel: 'high',
    approvalMessage: 'This will deploy to production',
    sensitiveArgs: ['environment', 'version'],
  },
};

// App developer can override at registration
agent.tools.register(myTool, {
  permission: { scope: 'session' },  // Relax to session-level approval
});
```

For complete documentation, see the [User Guide](./USER_GUIDE.md#tool-permissions).

### 5. Session Persistence

Save and resume full context state including conversation history and plugin states:

```typescript
import { AgentContextNextGen, createFileContextStorage } from '@everworker/oneringai';

// Create storage for the agent
const storage = createFileContextStorage('my-assistant');

// Create context with storage
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { workingMemory: true },
  storage,
});

// Build up state
ctx.addUserMessage('Remember: my favorite color is blue');
await ctx.memory?.store('user_color', 'User favorite color', 'blue');

// Save session with metadata
await ctx.save('session-001', { title: 'User Preferences' });

// Later... load session
const ctx2 = AgentContextNextGen.create({ model: 'gpt-4.1', storage });
const loaded = await ctx2.load('session-001');

if (loaded) {
  // Full state restored: conversation, plugin states, etc.
  const color = await ctx2.memory?.retrieve('user_color');
  console.log(color); // 'blue'
}
```

**What's Persisted:**
- Complete conversation history
- All plugin states (WorkingMemory entries, InContextMemory, etc.)
- System prompt

**Storage Location:** `~/.oneringai/agents/<agentId>/sessions/<sessionId>.json`

### Storage Registry

Swap all storage backends (sessions, media, custom tools, OAuth tokens, etc.) with a single `configure()` call at init time. No breaking changes — all existing APIs continue to work.

```typescript
import { StorageRegistry } from '@everworker/oneringai';

StorageRegistry.configure({
  media: new S3MediaStorage(),
  oauthTokens: new EncryptedFileTokenStorage(),
  // Context-aware factories — optional StorageContext for multi-tenant partitioning
  customTools: (ctx) => new MongoCustomToolStorage(ctx?.userId),
  sessions: (agentId, ctx) => new RedisContextStorage(agentId, ctx?.tenantId),
  persistentInstructions: (agentId, ctx) => new DBInstructionsStorage(agentId, ctx?.userId),
  workingMemory: (ctx) => new RedisMemoryStorage(ctx?.tenantId),
  routineDefinitions: (ctx) => new MongoRoutineStorage(ctx?.userId),
});

// All agents and tools automatically use these backends
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });
```

**Resolution order:** explicit constructor param > `StorageRegistry` > file-based default.

**Multi-tenant:** Factories receive an optional `StorageContext` (opaque, like `ConnectorAccessContext`). Set via `StorageRegistry.setContext({ userId, tenantId })` — auto-forwarded to all factory calls for per-user/per-tenant storage partitioning.

See the [User Guide](./USER_GUIDE.md#centralized-storage-registry) for full documentation.

### 6. Working Memory

Use the `WorkingMemoryPluginNextGen` for agents that need to store and retrieve data:

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [weatherTool, emailTool],
  context: {
    features: { workingMemory: true },
  },
});

// Agent now has unified store_get, store_set, store_delete, store_list, store_action tools
await agent.run('Check weather for SF and remember the result');
```

**Features:**
- 📝 **Working Memory** - Store and retrieve data with priority-based eviction
- 🏗️ **Hierarchical Memory** - Raw → Summary → Findings tiers for research tasks
- 🧠 **Context Management** - Automatic handling of context limits
- 💾 **Session Persistence** - Save/load via `ctx.save()` and `ctx.load()`

### 7. Research with Search Tools

Use `Agent` with search tools and `WorkingMemoryPluginNextGen` for research workflows:

```typescript
import { Agent, ConnectorTools, Connector, Services, tools } from '@everworker/oneringai';

// Setup search connector
Connector.create({
  name: 'serper-main',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

// Create agent with search and memory
const searchTools = ConnectorTools.for('serper-main');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [...searchTools, tools.webFetch],
  context: {
    features: { workingMemory: true },
  },
});

// Agent can search and store findings in memory
await agent.run('Research AI developments in 2026 and store key findings');
```

**Features:**
- 🔍 **Web Search** - SearchProvider with Serper, Brave, Tavily, RapidAPI
- 📝 **Working Memory** - Store findings with priority-based eviction
- 🏗️ **Tiered Memory** - Raw → Summary → Findings pattern

### 8. Context Management

**AgentContextNextGen** is the modern, plugin-based context manager. It provides clean separation of concerns with composable plugins:

```typescript
import { Agent, AgentContextNextGen } from '@everworker/oneringai';

// Option 1: Use AgentContextNextGen directly (standalone)
const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  systemPrompt: 'You are a helpful assistant.',
  features: { workingMemory: true, inContextMemory: true },
});

ctx.addUserMessage('What is the weather in Paris?');
const { input, budget } = await ctx.prepare(); // Ready for LLM call

// Option 2: Via Agent.create
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    features: { workingMemory: true },
  },
});

// Agent uses AgentContextNextGen internally
await agent.run('Check the weather');
```

#### Feature Configuration

Enable/disable features independently. Disabled features = no associated tools registered:

```typescript
// Minimal stateless agent (no memory)
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    features: { workingMemory: false }
  }
});

// Full-featured agent with all plugins
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    features: {
      workingMemory: true,
      inContextMemory: true,
      persistentInstructions: true
    },
    agentId: 'my-assistant',  // Required for persistentInstructions
  }
});
```

**Available Features:**
| Feature | Default | Plugin | Associated Tools |
|---------|---------|--------|------------------|
| `workingMemory` | `true` | WorkingMemoryPluginNextGen | Unified `store_*` tools (store="notes"). Actions: cleanup_raw, query |
| `inContextMemory` | `true` | InContextMemoryPluginNextGen | Unified `store_*` tools (store="whiteboard") |
| `persistentInstructions` | `false` | PersistentInstructionsPluginNextGen | Unified `store_*` tools (store="instructions"). Actions: clear |
| `userInfo` | `false` | UserInfoPluginNextGen | Unified `store_*` tools (store="user_info") + `todo_add/update/remove` |
| `toolCatalog` | `false` | ToolCatalogPluginNextGen | `tool_catalog_search/load/unload` |
| `sharedWorkspace` | `false` | SharedWorkspacePluginNextGen | Unified `store_*` tools (store="workspace"). Actions: log, history, archive, clear |
| `memory` | `false` | MemoryPluginNextGen | 6 read tools: `memory_recall`, `memory_graph`, `memory_search`, `memory_search_documents`, `memory_find_entity`, `memory_list_facts`. Requires `plugins.memory.memory: MemorySystem`. |
| `memoryWrite` | `false` | MemoryWritePluginNextGen | 6 write tools: `memory_remember`, `memory_link`, `memory_upsert_entity`, `memory_forget`, `memory_restore`, `memory_set_agent_rule`. Requires `memory: true`. |

**AgentContextNextGen architecture:**
- **Plugin-first design** - All features are composable plugins
- **ToolManager** - Tool registration, execution, circuit breakers
- **Single system message** - All context components combined
- **Smart compaction** - Happens once, right before LLM call

**Compaction strategy:**
- **algorithmic** (default) - Moves large tool results to Working Memory, limits tool pairs, and applies a rolling window after the configured critical threshold is crossed.

**Context preparation:**
```typescript
const { input, budget, compacted, compactionLog } = await ctx.prepare();

console.log(budget.totalUsed);           // Total tokens used
console.log(budget.available);           // Remaining tokens
console.log(budget.utilizationPercent);  // Usage percentage
```

**Forced provider-session rollover:** automatic compaction is token-triggered;
`rolloverContext()` is an explicit semantic checkpoint for a provider lifetime
boundary such as OpenAI Realtime's 60-minute limit:

```typescript
const result = await agent.rolloverContext({
  preserveRecentTurns: 8, // exact messages, including complete tool pairs
  reason: 'provider-session-expiring',
});
```

The Agent summarizes the older prefix with a tool-free direct call, replaces it
atomically with a continuity brief, leaves plugin state and the append-only
history journal untouched, and checkpoints automatically when session storage
is configured. It cannot race `run()`, `stream()`, async continuation, or an
active Realtime execution. A host may provide `summarize` to use a separate
trusted summarizer or proxy. Standalone contexts expose the lower-level
`ctx.rollover({ summarize, preserveRecentTurns })` API.

### 9. InContextMemory

Store key-value pairs **directly in context** for instant LLM access without retrieval calls:

```typescript
import { AgentContextNextGen } from '@everworker/oneringai';

const ctx = AgentContextNextGen.create({
  model: 'gpt-4.1',
  features: { inContextMemory: true },
  plugins: {
    inContextMemory: { maxEntries: 20 },
  },
});

// Access the plugin
const plugin = ctx.getPlugin('in_context_memory');

// Store data - immediately visible to LLM
plugin.set('current_state', 'Task processing state', { step: 2, status: 'active' });
plugin.set('user_prefs', 'User preferences', { verbose: true }, 'high');

// Store host-owned UI metadata through the direct API
plugin.set('dashboard', 'Progress dashboard', '## Progress\n- [x] Step 1\n- [ ] Step 2', 'normal', true);

// LLM uses unified store tools: store_set("whiteboard", ...), store_get("whiteboard", ...), etc.
// Or access directly via plugin API
const state = plugin.get('current_state');  // { step: 2, status: 'active' }
```

**Key Difference from WorkingMemory:**
- **WorkingMemory**: External storage + index → requires `store_get("notes", key)` for values
- **InContextMemory**: Full values in context → instant access, no retrieval needed

**UI metadata (`showInUI`):** OneRingAI stores, serializes, and reports this
flag, but does not render a sidebar or implement pinning. The built-in
`store_set` schema intentionally does not advertise the field to the LLM; host
code can set it through the direct API or expose it deliberately in a custom UI
integration. See the [User Guide](./USER_GUIDE.md#ui-display-showinui).

**Use cases:** Session state, user preferences, counters, flags, small accumulated results, live dashboards.

### 10. Persistent Instructions

Store agent-level custom instructions that persist across sessions on disk:

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    agentId: 'my-assistant',  // Required for storage path
    features: {
      persistentInstructions: true,
    },
  },
});

// LLM uses unified store tools: store_set("instructions", ...), store_delete("instructions", ...), etc.
// Instructions persist to ~/.oneringai/agents/my-assistant/custom_instructions.json
```

**Key Features:**
- 📁 **Disk Persistence** - Instructions survive process restarts and sessions
- 🔧 **LLM-Modifiable** - Agent can update its own instructions during execution
- 🔄 **Auto-Load** - Instructions loaded automatically on agent start
- 🛡️ **Never Compacted** - Critical instructions always preserved in context

**Store Tools (via unified `store_*` interface):**
- `store_set("instructions", key, { content })` - Add or update a single instruction by key
- `store_delete("instructions", key)` - Remove a single instruction by key
- `store_list("instructions")` - List all instructions with keys and content
- `store_action("instructions", "clear", { confirm: true })` - Remove all instructions

**Use cases:** Agent personality/behavior, user preferences, learned rules, tool usage patterns.

### 11. User Info

Store user-specific preferences and context that are automatically injected into the LLM system message:

```typescript
import { Agent } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'alice',  // Optional — defaults to 'default' user
  context: {
    features: {
      userInfo: true,
    },
  },
});

// LLM uses unified store tools: store_set("user_info", ...), store_get("user_info", ...), etc.
// Data persists to ~/.oneringai/users/alice/user_info.json
// All entries are automatically shown in context — no need to call store_get each turn
```

**Key Features:**
- 📁 **Disk Persistence** - User info survives process restarts and sessions
- 🔄 **Auto-Inject** - Entries rendered as markdown and included in the system message automatically
- 👥 **User-Scoped** - Data is per-user, not per-agent — different agents share the same user data
- 🔧 **LLM-Modifiable** - Agent can update user info during execution

**Store Tools (via unified `store_*` interface):**
- `store_set("user_info", key, { value, description? })` - Store/update user information
- `store_get("user_info", key?)` - Retrieve one entry or all entries
- `store_delete("user_info", key)` - Remove a specific entry
- `store_action("user_info", "clear", { confirm: true })` - Clear all entries

**TODO Tools** (built into the same plugin):
- `todo_add` - Create a TODO (`title`, `description?`, `people?`, `dueDate?`, `tags?`)
- `todo_update` - Update a TODO (`id`, plus any fields to change including `status: 'done'`)
- `todo_remove` - Delete a TODO by id

TODOs are stored alongside user info and rendered in a separate **"Current TODOs"** checklist in context. The agent proactively suggests creating TODOs when conversation implies action items, reminds about due/overdue items once per day, and auto-cleans completed TODOs after 48 hours.

**Use cases:** User preferences (theme, language, timezone), user context (role, location), accumulated knowledge about the user, task/TODO tracking with deadlines and people.

> ⚠️ **Deprecated** in favour of the Self-Learning Memory plugin below. `UserInfoPluginNextGen` + `PersistentInstructionsPluginNextGen` keep working unchanged for existing integrations — no breaking change — but new code should prefer `MemoryPluginNextGen`.

### Self-Learning Memory — plugin + tools

A brain-like, queryable knowledge store built on the [memory layer](./docs/MEMORY_GUIDE.md). Two cooperating context plugins + **12 LLM-callable tools** turn the agent into a learning system: it bootstraps a `person` entity for the user (and optionally an `organization` entity for their group), injects the evolving user profile + any user-given behavior rules into the system message every turn, and exposes `memory_*` tools so the LLM can read or write the knowledge graph mid-conversation. Observations flow in via `memory_remember` (LLM-driven) or `SessionIngestorPluginNextGen` (passive); incremental profile regeneration synthesises them; the next turn sees the updated profile. No manual prompt engineering for user/agent preferences.

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

const memory = createMemorySystemWithConnectors({
  store: new InMemoryAdapter(),                 // or MongoMemoryAdapter for production
  connectors: {
    embedding: { connector: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    profile:   { connector: 'anthropic', model: 'claude-sonnet-4-6' },
  },
  predicates,
  predicateMode: 'strict',
  visibilityPolicy: () => ({ group: 'read', world: 'none' }),
});

const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  userId: 'alice',                              // REQUIRED — memory's owner invariant
  context: {
    agentId: 'my-assistant',
    features: {
      memory: true,                             // reads: profile injection + 6 retrieval tools
      memoryWrite: true,                        // writes: 6 mutation tools (omit for retrieval-only)
    },
    plugins: {
      memory: {
        memory,
        // groupId: 'team-A',                   // trusted, from your auth layer
        // userProfileInjection: { topFacts: 20, relatedTasks: true },
        // groupBootstrap: { displayName: 'Acme', identifiers: [{ kind: 'domain', value: 'acme.com' }] },
      },
    },
  },
});

await agent.run('Remember I prefer concise answers');
// Agent calls memory_remember({subject:"me", predicate:"prefers", value:"concise answers"})
// Fact is available to recall immediately; profile regeneration runs after the configured threshold.
```

**Key Features:**
- 🧠 **Self-learning** — profiles synthesised from facts via incremental regeneration (prior profile + new facts + invalidated IDs → evolved profile)
- 🔐 **Three-principal permissions** — owner / group / world, enforced at the adapter
- 🎟️ **Principal-based ACLs** — opt-in explicit grants beyond owner/group/world via an `acl` of principal tokens (`user:`/`entity:`/`group:`/`service:`/`world`); materialized `read`/`writePrincipals` queried by `scope.principals`, mutated with `setAccess`, and survive `mergeEntities` ("account links later"). Backwards compatible; run `backfillAccessPrincipals` before flipping to principal mode. See [docs/MEMORY_PERMISSIONS.md § Principal-based ACLs](./docs/MEMORY_PERMISSIONS.md#principal-based-acls-explicit-grants)
- 📊 **Ranked recall** — profile + top facts by `confidence × recency × predicateWeight × importance`
- 🕸️ **Graph queries** — Mongo native `$graphLookup` when available, iterative BFS fallback
- 🔍 **Semantic search** — over embedded facts (with Atlas Vector Search at scale)
- 🧬 **Multi-ID entities** — lookup by email / slack_id / github_login / domain / any identifier; upsert auto-merges
- 📜 **Supersession history** — corrections archive predecessors; audit chain preserved via `archivedOnly: true`
- 🪧 **User-driven behavior rules** — `memory_set_agent_rule` records "be terse" / "reply in Russian" / "your name is Jason" directives, rendered back into the system message every turn (per-user-per-agent scoped)
- 🏢 **Optional org bootstrap** — when `groupBootstrap` is set, an `organization` entity is upserted and rendered as an "About the User's Organization" block alongside the user profile
- 🛡️ **LLM-safe** — `groupId` fixed by host app (never from tool args); ghost-write protection; foreign `contextIds` force owner-only permissions; numeric limits clamped

**12 LLM tools** (`memory_*`), split into two opt-in bundles:

*Read (via `MemoryPluginNextGen`, feature flag `memory`):*
- `memory_recall(subject, include?)` — profile + top facts + optional tiers (`documents` / `semantic` / `neighbors`)
- `memory_graph(start, direction, maxDepth, predicates?)` — N-hop traversal
- `memory_search(query, topK?, filter?)` — semantic text search across facts
- `memory_search_documents(query, mode?, attachedTo?, role?, limit?)` — search long-form documents (`type='document'`) by content. Semantic mode matches `contentEmbedding`; keyword mode is case-insensitive substring over body + title.
- `memory_find_entity(by, action? ∈ {find, list})` — lookup or list (read-only)
- `memory_list_facts(subject, predicate?, archivedOnly?)` — structured enumeration

*Write (via `MemoryWritePluginNextGen`, feature flag `memoryWrite`, requires `memory: true`):*
- `memory_remember(subject, predicate, value?/objectId?/details?)` — write a fact (atomic or document); visibility is host-decided, not an LLM-settable arg
- `memory_link(from, predicate, to)` — write a relational fact
- `memory_upsert_entity(type, displayName, identifiers, ...)` — create or merge an entity by identifier
- `memory_forget(factId, replaceWith?)` — archive or supersede (rate-limited 10/60s/user)
- `memory_restore(factId)` — un-archive (undo for `memory_forget`)
- `memory_set_agent_rule(rule, replaces?)` — record a user-specific behavior rule for THIS agent

Enable `memory: true` alone for retrieval-only agents (and pair with `SessionIngestorPluginNextGen` for passive background learning); enable both flags for agents that write memory deliberately.

**Flexible `SubjectRef`** — every tool accepts any of: entity id, `"me"`, `"this_agent"`, `{id}`, `{identifier: {kind, value}}`, `{surface: "..."}`.

**Storage backends:** `InMemoryAdapter` (zero deps, dev/tests), `MongoMemoryAdapter` + `RawMongoCollection` (production servers — supports native `$graphLookup` + Atlas Vector Search via `ensureVectorSearchIndexes()`), `MongoMemoryAdapter` + `MeteorMongoCollection` (Meteor apps — reactive publications). Custom adapters implement `IMemoryStore`.

See the [USER_GUIDE Self-Learning Memory section](./USER_GUIDE.md#self-learning-memory-nextgen-plugin) for the user-guide-level walkthrough, [docs/MEMORY_GUIDE.md](./docs/MEMORY_GUIDE.md) for the full conceptual model + adapter setup + signal ingestion, [docs/MEMORY_API.md](./docs/MEMORY_API.md) for the `MemorySystem` API reference, and [docs/MEMORY_PERMISSIONS.md](./docs/MEMORY_PERMISSIONS.md) for the permission model.

### 12. Direct LLM Access

Bypass all context management for simple, stateless LLM calls:

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });

// Direct call - no history tracking, no memory, no context preparation
const response = await agent.runDirect('What is 2 + 2?');
console.log(response.output_text);  // "4"

// With options
const response = await agent.runDirect('Summarize this', {
  instructions: 'Be concise',
  temperature: 0.5,
  maxOutputTokens: 100,
});

// Multimodal (text + image)
const response = await agent.runDirect([
  { type: 'message', role: 'user', content: [
    { type: 'input_text', text: 'What is in this image?' },
    { type: 'input_image_url', image_url: { url: 'https://example.com/image.png' } }
  ]}
]);

// Streaming
for await (const event of agent.streamDirect('Tell me a story')) {
  if (event.type === 'output_text_delta') {
    process.stdout.write(event.delta);
  }
}
```

**Comparison:**

| Aspect | `run()` | `runDirect()` |
|--------|-------------------|---------------|
| History tracking | ✅ | ❌ |
| Memory/Cache | ✅ | ❌ |
| Context preparation | ✅ | ❌ |
| Agentic loop (tool execution) | ✅ | ❌ |
| Overhead | Full context management | Minimal |

**Use cases:** Quick one-off queries, embeddings-like simplicity, testing, hybrid workflows.

### Thinking / Reasoning (Per-Call)

Control reasoning effort per call — vendor-agnostic API that maps to OpenAI's `reasoning_effort`, Anthropic's `budget_tokens`, and Google's `thinkingBudget`:

```typescript
const agent = Agent.create({ connector: 'anthropic', model: 'claude-sonnet-4-6' });

// Set reasoning at agent level (applies to all calls)
const agent2 = Agent.create({
  connector: 'openai', model: 'o3-mini',
  thinking: { enabled: true, effort: 'medium' },
});

// Override per call via RunOptions
const deep = await agent.run('Prove this theorem', {
  thinking: { enabled: true, budgetTokens: 16384 },
});

const quick = await agent.run('What is 2+2?', {
  thinking: { enabled: true, effort: 'low' },
});

// Streaming with reasoning
for await (const event of agent.stream('Analyze this code', {
  thinking: { enabled: true, effort: 'high' },
})) { /* ... */ }

// Also works with runDirect()
const resp = await agent.runDirect('Quick question', {
  thinking: { enabled: true, effort: 'medium' },
});
```

**RunOptions** (for `run()` / `stream()`): `thinking`, `temperature`, `vendorOptions`,
`responseFormat`, `promptCache`, `nativeTools`, and `dataHandling` — override agent-level config for
a single call.

### Advanced Inference: Caching, Batches, and Provider-Hosted Tools

Advanced inference features use provider-neutral contracts while still reporting what the selected
provider/model can actually execute. They are available on ordinary agent calls, direct calls, and
the provider batch surface:

- **Prompt caching** — request or tune provider prompt/context caching without embedding vendor
  fields in application code.
- **Asynchronous text batches** — submit durable provider jobs, poll/cancel them, and stream
  correlated per-item results.
- **Provider-hosted tools** — web/X search, web fetch, code execution, file
  search, and remote MCP executed by the model provider rather than by
  `ToolManager`.
- **Detailed telemetry** — cache reads/writes, reasoning tokens, provider-tool counts, service tier,
  and interactive/batch processing mode.
- **Data-handling policy** — explicit opt-in for provider caching, retained batch data,
  provider-hosted tools, and third-party MCP calls.

#### Discover executable capabilities

Model-registry feature flags are useful catalog metadata. For runtime decisions, use the agent's
provider-aware capability report:

```typescript
const agent = Agent.create({ connector: 'openai-main', model: 'gpt-5.4' });
const caps = agent.getAdvancedCapabilities();

console.log(caps.promptCaching);
// { mode: 'implicit', ttlModes: ['short', 'extended'], reportsCacheUsage: true }

if (caps.nativeTools.includes('web_search')) {
  // Safe to offer the normalized provider-hosted web-search tool.
}

if (caps.batch.supported && agent.getBatchProvider()) {
  // This concrete provider/model pair has an executable batch adapter.
}
```

Capability discovery deliberately fails closed for unknown model families. Do not infer executable
support solely from a model name or `Model.features`.

| Provider | Prompt cache mode | Async batch | Normalized provider-hosted tools |
|----------|-------------------|-------------|----------------------------------|
| OpenAI | Implicit; key/retention controls where supported | Yes, model-gated | Web search, code execution, file search, remote MCP |
| Anthropic | Request-controlled cache markers with short/extended TTL | Yes, model-gated | Web search, web fetch, code execution, remote MCP on current server-tool families |
| Google | Implicit cache hits; no normalized TTL control | Yes, model-gated | Web search, web fetch, code execution on Gemini 2.5/3 text families |
| xAI | Model-gated implicit caching and usage reporting | Not normalized | Web search, X search, hosted code execution |

The table is an orientation, not a substitute for `getAdvancedCapabilities()`: availability is
model-specific and intentionally conservative.

#### Prompt caching

```typescript
const response = await agent.run('Analyze this long, stable policy document', {
  promptCache: {
    mode: 'auto',
    ttl: 'extended',
    key: 'policy-analysis-v3',
    strict: true,
  },
  dataHandling: { allowProviderCaching: true },
});

console.log(response.usage.cached_input_tokens);
console.log(response.usage.cache_creation_input_tokens);
```

`strict: true` rejects unsupported caching or TTL requests before inference. Without `strict`, an
unsupported cache request degrades to a normal request; an unsupported TTL is removed while the
remaining cache request may still be used.

GPT-5.6+ also supports caller-marked content breakpoints. Mark eligible input
text/image/file content with `promptCacheBreakpoint: true`; the default
`breakpointMode: 'implicit'` keeps OpenAI's automatic latest-message breakpoint
in addition to those markers. Set `breakpointMode: 'explicit'` only when the
request should disable the automatic breakpoint and use marked blocks alone.
OneRingAI emits the required `{ mode: 'explicit' }` content marker only after
the selected model and cache policy pass normalization; older models and
cache-disabled calls never receive an unsupported field.

`{ mode: 'off' }` means **OneRingAI does not request or configure caching**. It cannot disable cache
behavior a provider applies implicitly to otherwise ordinary requests. Likewise,
`allowProviderCaching` governs library-requested cache controls; it is not a legal or technical
guarantee that an implicitly-caching provider stores nothing. Apply provider account controls and
your own retention policy where that guarantee is required.

For useful cache hits, keep the stable shared prefix (instructions, policies, large reference
material) at the beginning of the prompt. OneRingAI does not reorder prompt content.

#### Provider-hosted tools

Provider-hosted tools are not registered with or executed by `ToolManager`; the provider runs them
inside its inference lifecycle:

```typescript
const researched = await agent.run('Research the latest release and summarize the changes', {
  nativeTools: [{ capability: 'web_search', options: { max_uses: 3 } }],
  dataHandling: { allowProviderTools: true },
});

console.log(researched.usage.native_tool_calls); // e.g. { web_search: 2 }
console.log(researched.native_tool_events);      // lifecycle/error details when available
```

Remote MCP authentication remains connector-first—raw bearer tokens are never part of the public
run configuration:

```typescript
const result = await agent.run('Look up the customer in our CRM', {
  nativeTools: [{
    capability: 'remote_mcp',
    server: {
      name: 'crm',
      url: 'https://mcp.example.com',
      authorization: { connector: 'crm-mcp', accountId: 'work' },
      allowedTools: ['find_customer'],
      requireApproval: 'never', // host-managed approval continuations are not normalized yet
    },
  }],
  dataHandling: { allowThirdPartyTools: true },
});
```

OneRingAI validates provider/model support, data policy, required options, approval support, and the
HTTPS MCP URL before it asks the scoped connector registry for a token. OpenAI file search requires
`{ capability: 'file_search', options: { vectorStoreIds: ['vs_123'] } }`.

`requireApproval: 'always'` is rejected until the adapter exposes a host-managed approval
continuation. OpenAI otherwise defaults MCP to approval-required, so the normalized executable path
uses `never` when the field is omitted. The explicit `allowThirdPartyTools` opt-in remains required.

Client tools and native tools can be used together, but they have different trust boundaries:

| Tool kind | Executor | Permission path | Result visibility |
|-----------|----------|-----------------|-------------------|
| `ToolFunction` | Your process through `ToolManager` | Tool permission policies | Explicit tool call/result messages |
| `nativeTools` | Selected LLM provider (and, for remote MCP, the configured third party) | `dataHandling` + provider controls | Provider response, citations, usage, and native-tool events |

#### Asynchronous text batches

The batch surface is intentionally separate from `run()`: the host owns durable job handles,
polling, scheduling, and recovery. The surface returned by an Agent is identity-bound: every
submission inherits that Agent's `userId` and scoped connector registry.

```typescript
const batch = agent.getBatchProvider();
const caps = agent.getAdvancedCapabilities();
if (!caps.batch.supported || !batch) {
  throw new Error('Selected provider/model does not support batch inference');
}

const handle = await batch.submitBatch(
  [
    {
      customId: 'lead-1',
      options: {
        model: agent.model,
        input: 'Write a concise introduction for Lead 1',
        prompt_cache: { mode: 'auto', ttl: 'extended' },
        data_handling: { allowProviderCaching: true },
      },
    },
    {
      customId: 'lead-2',
      options: { model: agent.model, input: 'Write a concise introduction for Lead 2' },
    },
  ],
  {
    metadata: { workflow: 'lead-intros' },
    dataHandling: { allowBatchRetention: true },
  },
);

await saveDurableBatchHandle(handle); // application responsibility

const status = await batch.getBatch(handle.id);
if (status.state === 'in_progress') {
  // Poll later; do not block a request indefinitely.
}

for await (const item of batch.getBatchResults(handle.id)) {
  if (item.response) {
    console.log(item.customId, item.response.output_text);
  } else {
    console.error(item.customId, item.error);
  }
}
```

`customId` must be non-empty and unique within a submission. Normalized states are `queued`,
`in_progress`, `completed`, `cancelling`, `cancelled`, `expired`, and `failed`. Results can be mixed:
one item may succeed while another returns a normalized item error.

Batch creation is a paid, non-idempotent boundary. If the transport fails after the provider may
have accepted the job, OneRingAI throws `ProviderAmbiguousOperationError`. Persist its
`recoveryMetadata`, reconcile with provider-side jobs, and **do not blindly resubmit**. Batch
retention must be explicitly authorized with `allowBatchRetention: true`.

The low-level batch `options` use `TextGenerateOptions` names (`prompt_cache`, `native_tools`,
`data_handling`, `response_format`). Unsupported native structured-output requests are normalized to
the prompt fallback before submission; malformed schemas fail before the paid boundary.

#### Usage and cost telemetry

```typescript
const usage = response.usage;
console.log({
  input: usage.input_tokens,
  cachedInput: usage.cached_input_tokens,
  cacheWrite: usage.cache_creation_input_tokens,
  cacheWriteByTtl: usage.cache_creation_details,
  output: usage.output_tokens,
  reasoning: usage.output_tokens_details?.reasoning_tokens,
  nativeTools: usage.native_tool_calls,
  processingMode: usage.processing_mode, // 'interactive' | 'batch'
  serviceTier: usage.service_tier,
});

const estimated = calculateCost(agent.model, usage.input_tokens, usage.output_tokens, {
  cachedInputTokens: usage.cached_input_tokens,
  cacheCreationInputTokens: usage.cache_creation_input_tokens,
  cacheCreationDetails: usage.cache_creation_details && {
    shortTtlInputTokens: usage.cache_creation_details.short_ttl_input_tokens,
    extendedTtlInputTokens: usage.cache_creation_details.extended_ttl_input_tokens,
  },
  processingMode: usage.processing_mode,
});
```

Detailed fields are populated only when the provider reports them. Agent execution metrics also
aggregate `cachedInputTokens`, `cacheCreationInputTokens`, `reasoningTokens`, and `nativeToolCalls`
across iterations and structured-output repair calls.

For the complete contracts, provider behavior, batch recovery guidance, and troubleshooting, see
[Advanced Inference in the User Guide](./USER_GUIDE.md#advanced-inference).

### Structured Output (JSON)

Ask for JSON — as **any object** or **schema-constrained** — with one vendor-agnostic option. The library uses each vendor's *native* structured-output mechanism when the model supports it (OpenAI `text.format`, Anthropic `output_config.format`, Google/Vertex `responseJsonSchema`) and otherwise falls back to a strict prompt instruction. The parsed value is attached to `response.output_parsed`; the raw JSON stays in `response.output_text`.

```typescript
// Schema-constrained output
const res = await agent.run('Extract the contact from: Jane Doe, jane@acme.com, Enterprise plan', {
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

// Any-JSON mode (no schema)
const summary = await agent.run('Summarize this ticket as JSON with `title` and `priority`', {
  responseFormat: { type: 'json_object' },
});

// Also works on runDirect() (single-shot, no context management)
const direct = await agent.runDirect('List 3 primary colors as a JSON array of strings', {
  responseFormat: { type: 'json_object' },
});
console.log(direct.output_parsed); // ['red', 'green', 'blue']
```

**Same API on every vendor.** Switch the connector from `openai` to `anthropic`, `google`, `grok`, etc. — the call is identical; the library picks the right native mechanism or the prompt fallback per model.

**Notes**
- **Scope:** JSON output only (`json_object` and `json_schema`).
- **Validation contract:** on the *native* path the vendor enforces its supported schema subset server-side. Provider adapters may move unsupported constraints into descriptions so the native request remains portable; Anthropic uses its official SDK transformer for this normalization. On the *prompt-fallback* path the library guarantees the output is **valid, parseable JSON** but does **not** itself validate schema conformance. Validate `output_parsed` against the original schema when you need every constraint enforced. (No JSON-schema-validator dependency is added.)
- **Per-vendor:** OpenAI, current supported Anthropic families, and Google/Vertex use native schema output when the concrete model supports it. Older or unknown Claude models retain the prompt fallback. `json_object` remains prompt-based on Anthropic because its native contract is schema-based.
- **Tool loops:** with `run()`, structured output constrains the *final* answer. OpenAI composes natively; Google composition is model-specific. Anthropic conservatively uses a final tool-free formatting pass whenever tools are present because citation-producing server tools are incompatible with JSON outputs.
- **Enforcement telemetry:** `structured_output_enforcement` reports `native`, `prompt`, or `repair` on non-streaming formatted responses.
- **Streaming:** `stream()` / `streamDirect()` stream raw text and do not attach `output_parsed` (parse the accumulated text yourself). Structured output on `stream()` is enforced only where it applies *inline* — natively, or the prompt fallback with no tools. Unlike `run()`, `stream()` has **no** final tool-free reformat pass, so with tools enabled on a prompt-fallback provider/model the streamed output is **not guaranteed** to be JSON (a warning is logged). **For guaranteed structured output with tools, use `run()`.**
- **Failures are never silent:** if the model can't produce parseable JSON after one bounded re-ask, a `StructuredOutputError` (carrying the raw output + schema) is thrown and logged.
- **`RunOptions.responseFormat` / `DirectCallOptions.responseFormat`** accept the vendor-agnostic `ResponseFormat` type (exported from the package root).

### 13. Audio Capabilities

Text-to-Speech and Speech-to-Text with multiple providers:

```typescript
import { TextToSpeech, SpeechToText } from '@everworker/oneringai';

// === Text-to-Speech ===
const tts = TextToSpeech.create({
  connector: 'openai',
  model: 'tts-1-hd',       // or 'gpt-4o-mini-tts' for instruction steering
  voice: 'nova',
});

// Synthesize to file
await tts.toFile('Hello, world!', './output.mp3');

// Synthesize with options
const audio = await tts.synthesize('Speak slowly', {
  format: 'wav',
  speed: 0.75,
});

// Introspection
const voices = await tts.listVoices();
const models = tts.listAvailableModels();

// === Speech-to-Text ===
const stt = SpeechToText.create({
  connector: 'openai',
  model: 'gpt-transcribe', // current file-transcription model
});

// Transcribe
const result = await stt.transcribeFile('./audio.mp3');
console.log(result.text);

// With timestamps
const detailed = await stt.transcribeWithTimestamps(audioBuffer, 'word');
console.log(detailed.words);  // [{ word, start, end }, ...]

// Translation
const english = await stt.translate(frenchAudio);
```

`TextToSpeech.listVoices()` returns the library's deterministic built-in voice
catalog. Use `OpenAIVoices.create()` for OpenAI prompt- or consent-based custom
voice creation; prompt-designed voices work only with GPT-Live, while voices
created from an audio sample and consent can also be used by TTS and Realtime.
For Google's remote custom-voice lifecycle and catalog, use `GoogleVoices`;
Google TTS accepts returned `voice_…`, `voicekey_…`, and `voices/…` identifiers
without treating them as prebuilt voice names.

File paths and self-describing buffers retain their container format. For
headerless `Buffer` input, set `encoding` and `sampleRate`; the default is
16-bit little-endian PCM at 16 kHz. AAC ADTS buffers—including CRC-protected
variants—are distinguished from MP3 frame-sync bytes, and `SpeechToText.translate()` forwards both configured
and per-call language hints. Google Gemini transcription returns
normalized segment timestamps, while word-level timestamps remain available
on models such as `whisper-1`. Raw μ-law and A-law sent to OpenAI are wrapped
as standards-compliant non-PCM `WAVEFORMATEX` files with the required `cbSize`.

**Streaming TTS** — for real-time voice applications:

```typescript
// Stream audio chunks as they arrive from the API
for await (const chunk of tts.synthesizeStream('Hello!', { format: 'pcm' })) {
  if (chunk.audio.length > 0) playPCMChunk(chunk.audio);  // 24kHz 16-bit LE mono
  if (chunk.isFinal) break;
}

// VoiceStream wraps agent text streams with interleaved audio events
const voice = VoiceStream.create({
  ttsConnector: 'openai', ttsModel: 'tts-1-hd', voice: 'nova',
});
for await (const event of voice.wrap(agent.stream('Tell me a story'))) {
  handleVoiceEvent(event);
}
```

### OpenAI Realtime API (GA)

Build native speech-to-speech agents, streaming transcription, and continuous
speech translation with the current OpenAI Realtime API. OneRingAI provides a
connector-first server WebSocket client, ephemeral WebRTC credentials, SIP call
control, a transport-neutral Agent session, and a production telephony pipeline:

```typescript
import { Agent, OpenAIRealtimeAgentSession } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-realtime-2.1',
  instructions: 'Be concise and confirm consequential actions.',
  tools: [lookupOrder],
  permissions: { onApprovalRequired: approveTool },
});

const realtime = new OpenAIRealtimeAgentSession({
  agent,
  session: {
    reasoning: { effort: 'low' },
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        turn_detection: { type: 'semantic_vad', eagerness: 'auto' },
      },
      output: { format: { type: 'audio/pcm', rate: 24000 }, voice: 'marin' },
    },
  },
});

realtime.on('audio', playPcm24);
realtime.on('usage', recordUsage);
await realtime.connect();
realtime.appendAudio(pcm24Chunk);
```

`OpenAIRealtimeAgentSession` refreshes Agent memory/context per turn and runs
parallel local functions through the normal Agent hook, approval, permission,
timeout, identity, event, and metrics path. Provider MCP approvals fail closed.
`OpenAIRealtimeAPI` creates short-lived WebRTC client secrets, exchanges SDP
while preserving the sideband call ID,
and accepts, rejects, transfers, or hangs up SIP calls. `VoiceBridge` uses the
same semantics with PCMU telephony audio, VAD, barge-in truncation, tools, MCP,
usage, tracing, and retention-ratio truncation. See
the [complete OpenAI Realtime API guide](./USER_GUIDE.md#openai-realtime-api)
for voice-agent, transcription, translation, WebRTC, SIP, tool, event, pricing,
and production examples. A runnable server-side example is also available at
[`examples/openai-realtime.ts`](./examples/openai-realtime.ts).

For local desktop execution, export the resolved Agent with
`exportAgentPackage()`, hydrate it in the desktop main process with
`hydrateAgentPackage()`, and connect its `OpenAIRealtimeAgentSession` to a
renderer WebRTC peer through `OpenAIRealtimeChannelTransport`. The browser-safe
peer is exported from `@everworker/oneringai/realtime-browser`. See the
[distributed execution design](./docs/designs/DISTRIBUTED_AGENT_EXECUTION.md).

Portable packages omit connector credentials, source identity, arbitrary
`vendorOptions`, provider-hosted `nativeTools`, prompt-cache policy,
data-handling policy, and open-ended Realtime session configuration. Supply
trusted provider-local policy through `agentConfig`. Hydration requires the
trusted host to provide an authorized connector, model, permission policy, and
`contextFactory`; mutable package feature flags never activate plugins or
broaden tool scopes. Instruction templates are rendered again with the
receiving host's user/model, and context-owned tools are recreated by the
receiving context rather than exported as proxies. Hydration rejects any
portable tool name that collides with a trusted context, identity, or
host-provided tool.

Protocol v2 also fails closed on local executable drift. Custom local tools
need an explicit shared fingerprint and `localToolResolver` returns a
`ResolvedLocalTool`; generated built-ins use runtime-aware registry
fingerprints. Version 1 and version 2 peers cannot share a package/tool-server
session, so deploy the exporting and receiving runtimes together.

Fingerprints use JSON-wire canonicalization. Dynamic function descriptions are
presentation metadata regenerated from each host's trusted context and are not
part of the local executable contract. Remote definition fingerprints are
recomputed during package validation to detect inconsistent descriptors; they
are consistency checks, not package signatures.

Remote tool requests and responses are exact, JSON-only protocol objects.
Arguments and successful results are each limited to 1,000,000 UTF-8 bytes;
unknown fields, non-JSON values, cross-package calls, and non-allowlisted tools
fail closed.

Pass `executionProfile: 'realtime'` when hydrating a voice runtime so the Agent
uses the package's Realtime connector and model instead of its normal text
model.

The provider-specific `GrokRealtimeSession` facade and the shared telephony
pipeline support xAI's OpenAI-compatible Voice Agent API with `Vendor.Grok`,
`grok-voice-latest`, xAI
ephemeral credentials, session resumption, SIP refer/hangup, PCMU/PCMA/Opus,
PCM at 8/16/22.05/24/32/44.1/48 kHz, and JSON or binary audio transport. xAI
turn detection accepts `server_vad` or disabled detection; `semantic_vad` is
OpenAI-only and is rejected before the session connects. OpenAI's 24 kHz PCM
rule is checked for constructor configuration and every later `session.update`;
the xAI-specific facade retains its full rate range for both paths. See the
[xAI section of the realtime User Guide](./USER_GUIDE.md#xai-realtime-voice-agent-api).

**Available Models:**

- **TTS**: OpenAI (`tts-1`, `tts-1-hd`, `gpt-4o-mini-tts`), Google
  (`gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`, plus maintained older
  entries), xAI (`xai-tts`, REST and WebSocket)
- **STT**: OpenAI (`gpt-transcribe`, `gpt-live-transcribe`,
  `gpt-realtime-whisper`, GPT-4o, Whisper), Google (`gemini-3.5-transcribe`,
  `gemini-3.5-transcribe-live`), Groq (`whisper-large-v3`,
  `whisper-large-v3-turbo`), xAI (`grok-voice-transcribe-2.0`; legacy alias
  `xai-stt`, REST and WebSocket)

### Embeddings

Generate text embeddings across multiple vendors and mixed-modality embeddings with Gemini Embedding 2. Supports Matryoshka Representation Learning (MRL) for flexible output dimensions.

```typescript
import { Embeddings, Connector, Vendor } from '@everworker/oneringai';

// Setup
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

const embeddings = Embeddings.create({ connector: 'openai' });

// Single text
const result = await embeddings.embed('Hello world');
console.log(result.embeddings[0].length);  // 1536 (default for text-embedding-3-small)

// Batch with custom dimensions (MRL)
const batch = await embeddings.embed(
  ['search query', 'document chunk 1', 'document chunk 2'],
  { dimensions: 512 }
);
console.log(batch.embeddings.length);     // 3
console.log(batch.embeddings[0].length);  // 512

// Gemini Embedding 2 maps text, images, audio, video, and documents into one space.
Connector.create({
  name: 'google',
  vendor: Vendor.Google,
  auth: { type: 'api_key', apiKey: process.env.GOOGLE_API_KEY! },
});
const multimodal = Embeddings.create({ connector: 'google' });
const assetVector = await multimodal.embedMultimodal([
  { type: 'text', text: 'Product launch asset' },
  { type: 'image', data: './campaign.png', mimeType: 'image/png' },
  { type: 'document', data: './brief.pdf', mimeType: 'application/pdf' },
], { dimensions: 1024 });

// External HTTP(S) media is fetched and inlined; gs:// and Gemini Files URIs
// remain provider-hosted file references.

// Local with Ollama (free, no API key)
Connector.create({
  name: 'ollama-local',
  vendor: Vendor.Ollama,
  auth: { type: 'none' },
  baseURL: 'http://localhost:11434/v1',
});

const local = Embeddings.create({ connector: 'ollama-local' });
const localResult = await local.embed('semantic search query');
// Uses embeddinggemma by default (compact, multilingual, 768 dims)
```

External media is streamed into a bounded buffer with a 30-second default
download timeout, `Content-Length` preflight, a 100 MB aggregate inline budget,
and Google's 50 MB PDF ceiling. Override only the timeout with
`vendorOptions.mediaDownloadTimeoutMs`. When `mimeType` is omitted, OneRingAI
inspects common image, audio, video (including MOV), and PDF signatures before
falling back to the path extension. Explicit MIME types always win.

**Model introspection and cost estimation:**

```typescript
import {
  getEmbeddingModelInfo,
  getEmbeddingModelsByVendor,
  calculateEmbeddingCost,
  EMBEDDING_MODELS,
  Vendor,
} from '@everworker/oneringai';

// Model details
const info = getEmbeddingModelInfo('text-embedding-3-small');
console.log(info.capabilities.maxDimensions);       // 1536
console.log(info.capabilities.features.matryoshka);  // true (supports MRL)
console.log(info.capabilities.maxTokens);            // 8191

// Cost estimation
const cost = calculateEmbeddingCost('text-embedding-3-small', 1_000_000);
console.log(`$${cost} per 1M tokens`);  // $0.02

// Browse models by vendor
const ollamaModels = getEmbeddingModelsByVendor(Vendor.Ollama);
console.log(ollamaModels.map(m => `${m.name} (${m.capabilities.defaultDimensions}d)`));
// ['embeddinggemma (768d)', 'all-minilm (384d)', 'qwen3-embedding (4096d)', ...]
```

**Available Embedding Models:**

| Vendor | Model | Dims | MRL | Tokens | Price/1M |
|--------|-------|------|-----|--------|----------|
| OpenAI | `text-embedding-3-small` | 1536 | yes | 8191 | $0.02 |
| OpenAI | `text-embedding-3-large` | 3072 | yes | 8191 | $0.13 |
| OpenAI | `text-embedding-ada-002` (legacy) | 1536 | no | 8191 | $0.10 |
| Google | `gemini-embedding-2` | 3072 | yes | 8192 | $0.20 text; modality-specific rates |
| Google | `gemini-embedding-001` | 3072 | yes | 2048 | $0.15 |
| Mistral | `mistral-embed` | 1024 | no | 8192 | $0.10 |
| Mistral | `codestral-embed` | 3072 | yes | 8192 | $0.15 |
| Ollama | `embeddinggemma` (default) | 768 | yes | 2048 | Free (local) |
| Ollama | `all-minilm` | 384 | no | 512 | Free (local) |
| Ollama | `qwen3-embedding` (8B) | 4096 | yes | 8192 | Free (local) |
| Ollama | `qwen3-embedding:0.6b` | 1024 | yes | 8192 | Free (local) |
| Ollama | `nomic-embed-text` | 768 | yes | 8192 | Free (local) |

### 14. Model Registry

Schema-v2 metadata for current text/realtime models, with lifecycle, aliases,
snapshots, endpoints, replacement models, pricing modes, context windows, and
feature flags:

```typescript
import { getModelInfo, calculateCost, LLM_MODELS, MODEL_REGISTRY_SCHEMA_VERSION, Vendor } from '@everworker/oneringai';

// Get model information
const model = getModelInfo('gpt-6-astra');
console.log(MODEL_REGISTRY_SCHEMA_VERSION); // 2
console.log(model?.features.input.tokens);  // 1050000 total context-window guardrail
console.log(model?.lifecycle);              // 'active'

// Calculate costs
const cost = calculateCost('gpt-5.6-luna', 50_000, 2_000);
console.log(`Cost: $${cost}`);  // $0.0124

// With mixed cached and uncached input
const cachedCost = calculateCost('gpt-5.6-luna', 50_000, 2_000, {
  cachedInputTokens: 30_000,
  processingMode: 'batch',
});
console.log(`Optimized: $${cachedCost}`); // $0.0035
```

**Available text/realtime models:**
- **OpenAI**: GPT-6 Astra, GPT-6.1 Sol, GPT-6 Sol/Luna, GPT-5.6 Cyber/Sol/Terra/Luna, GPT-Rosalind Research, earlier GPT/o-series, Deep Research, audio, Realtime/Live, and open-weight models
- **Anthropic**: Claude Opus 5.5 and Sonnet 5.5, Fable/Mythos/Opus/Sonnet 5 families, and maintained legacy entries
- **Google**: Gemini 3.8 Flash/Live, 3.7/3.6 Flash, 3.5/3.1 families, live/image variants, and maintained Gemini 2.5 entries
- **xAI**: Grok 4.7, 4.6, 4.5, 4.3, Build 0.1, 4.20/4.1 families, and Grok Voice Think Fast 2.0/1.0
- **DeepSeek (5)**: V4 Flash, V4 Pro, V4 Flash Vision Experimental, and retired compatibility records

See the [complete Model Registry guide](./USER_GUIDE.md#model-registry) and
[current registry audit](./docs/MODEL_REGISTRY_AUDIT.md) for migration details,
media registries, API-path changes, and official source links.

### 15. Streaming

Real-time responses:

```typescript
import { StreamHelpers } from '@everworker/oneringai';

for await (const text of StreamHelpers.textOnly(agent.stream('Hello'))) {
  process.stdout.write(text);
}
```

### 16. OAuth for External APIs

```typescript
import { OAuthManager, FileStorage } from '@everworker/oneringai';

const oauth = new OAuthManager({
  flow: 'authorization_code',
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  storage: new FileStorage({ directory: './tokens', encryptionKey: process.env.OAUTH_ENCRYPTION_KEY! }),
});

const authUrl = await oauth.startAuthFlow('user123');
```

### 17. Developer Tools

File system and shell tools for building coding assistants:

```typescript
import { developerTools } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: developerTools, // Includes all 11 tools
});

// Agent can now:
// - Read files (read_file)
// - Write files (write_file)
// - Edit files with surgical precision (edit_file)
// - Search files by pattern (glob)
// - Search content with regex (grep)
// - List directories (list_directory)
// - Execute shell commands (bash)
// - Start dev servers (dev_server)
// - Manage background processes (bg_process_output, bg_process_list, bg_process_kill)

await agent.run('Read package.json and tell me the dependencies');
await agent.run('Find all TODO comments in the src directory');
await agent.run('Run npm test and report any failures');
```

**Available Tools:**
- **read_file** - Read file contents with line numbers
- **write_file** - Create/overwrite files
- **edit_file** - Surgical find/replace edits
- **glob** - Find files by pattern (`**/*.ts`)
- **grep** - Search content with regex
- **list_directory** - List directory contents
- **bash** - Execute shell commands with safety guards
- **dev_server** - Start a development server in the background
- **bg_process_output** - Read output from a background process
- **bg_process_list** - List running background processes
- **bg_process_kill** - Stop a background process

**Safety Features:**
- Blocked dangerous commands (`rm -rf /`, fork bombs)
- Configurable blocked directories (`node_modules`, `.git`)
- Timeout protection (default 2 min)
- Output truncation for large outputs

### 18. Custom Tool Generation

Let agents **create their own tools** at runtime — draft, test, iterate, save, and reuse. The agent writes JavaScript code, validates it, tests it in the VM sandbox, and persists it for future use. All 6 meta-tools are auto-registered through the agent's normal tool manager.

```typescript
import { createCustomToolMetaTools, hydrateCustomTool } from '@everworker/oneringai';

// Give an agent the ability to create tools
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [...createCustomToolMetaTools()],
});

// The agent can now: draft → test → save tools autonomously
await agent.run('Create a tool that fetches weather data from the OpenWeather API');

// Later: load and use a saved tool
import { createFileCustomToolStorage } from '@everworker/oneringai';
const storage = createFileCustomToolStorage();
const definition = await storage.load(undefined, 'fetch_weather'); // undefined = default user
const weatherTool = hydrateCustomTool(definition!);

// Register on any agent
agent.tools.register(weatherTool, { source: 'custom', tags: ['weather', 'api'] });
```

**Meta-Tools:** `custom_tool_draft` (validate), `custom_tool_test` (execute in sandbox), `custom_tool_save` (persist), `custom_tool_list` (search), `custom_tool_load` (retrieve), `custom_tool_delete` (remove)

**Dynamic Descriptions:** Draft and test tools use `descriptionFactory` to show all available connectors and the full sandbox API — automatically updated when connectors are added or removed.

**Pluggable Storage:** Default `FileCustomToolStorage` saves to `~/.oneringai/users/<userId>/custom-tools/` (defaults to `~/.oneringai/users/default/custom-tools/` when no userId). Implement `ICustomToolStorage` for MongoDB, S3, or any backend.

> See the [User Guide](./USER_GUIDE.md#custom-tool-generation) for the complete workflow, sandbox API reference, and examples.

### 19. Desktop Automation Tools

OS-level desktop automation for building "computer use" agents — screenshot the screen, send to a vision model, receive tool calls (click, type, etc.), execute them, repeat:

```typescript
import { desktopTools } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools: desktopTools, // All 11 desktop tools
});

// Agent can now see and interact with the desktop:
await agent.run('Take a screenshot and describe what you see');
await agent.run('Open Safari and search for "weather forecast"');
```

**Available Tools:**
- **desktop_screenshot** - Capture full screen or region (returns image to vision model)
- **desktop_mouse_move** - Move cursor to position
- **desktop_mouse_click** - Click (left/right/middle, single/double/triple)
- **desktop_mouse_drag** - Drag from one position to another
- **desktop_mouse_scroll** - Scroll wheel (vertical and horizontal)
- **desktop_get_cursor** - Get current cursor position
- **desktop_keyboard_type** - Type text
- **desktop_keyboard_key** - Press shortcuts (e.g., `ctrl+c`, `cmd+shift+s`, `enter`)
- **desktop_get_screen_size** - Get screen dimensions and scale factor
- **desktop_window_list** - List visible windows
- **desktop_window_focus** - Bring a window to the foreground

**Key Design:**
- All coordinates are in **physical pixel space** (same as screenshot pixels) — no manual Retina scaling needed
- Screenshots use the `__images` convention for automatic multimodal handling across all providers (Anthropic, OpenAI, Google)
- Requires `@nut-tree-fork/nut-js` as an optional peer dependency: `npm install @nut-tree-fork/nut-js`

### 20. Document Reader

Universal file-to-LLM-content converter. Reads arbitrary document formats and produces clean markdown text with optional image extraction:

```typescript
import { DocumentReader, mergeTextPieces } from '@everworker/oneringai';

const reader = DocumentReader.create({
  defaults: {
    maxTokens: 50_000,
    extractImages: true,
    imageFilter: { minWidth: 100, minHeight: 100 },
  },
});

// Read from file path, URL, Buffer, or Blob
const result = await reader.read('/path/to/report.pdf');
const result = await reader.read('https://example.com/doc.xlsx');
const result = await reader.read({ type: 'buffer', buffer: myBuffer, filename: 'doc.docx' });

// Get merged markdown text
const markdown = mergeTextPieces(result.pieces);

// Metadata
console.log(result.metadata.format);          // 'pdf'
console.log(result.metadata.estimatedTokens); // 12500
console.log(result.metadata.processingTimeMs); // 234
```

**Automatic Integration — No Code Changes Needed:**
- **`read_file` tool** — Agents calling `read_file` on a PDF, DOCX, or XLSX get markdown text automatically
- **`web_fetch` tool** — Documents downloaded from URLs are auto-converted to markdown

**Content Bridge for Multimodal Input:**

```typescript
import { readDocumentAsContent } from '@everworker/oneringai';

// Convert document directly to Content[] for LLM input
const content = await readDocumentAsContent('/path/to/slides.pptx', {
  extractImages: true,
  imageDetail: 'auto',
  maxImages: 20,
});

// Use in agent.run() with text + images
await agent.run([
  { type: 'input_text', text: 'Analyze this presentation:' },
  ...content,
]);
```

**Pluggable Architecture:**
- 6 built-in format handlers (Office, Excel, PDF, HTML, Text, Image)
- 3 default transformers (header, table formatting, truncation)
- Custom handlers and transformers via `DocumentReader.create({ handlers, ... })`
- All heavy dependencies lazy-loaded (officeparser, exceljs, unpdf)

**Image Filtering:**
- Configurable min dimensions, min size, max count, pattern exclusions
- Automatically removes junk images (logos, icons, tiny backgrounds)
- Applied both at extraction time and at content conversion time

See the [User Guide](./USER_GUIDE.md#document-reader) for complete API reference and configuration options.

### 21. Routine Execution

Execute multi-step AI workflows where tasks run in dependency order with automatic validation:

```typescript
import { executeRoutine, createRoutineDefinition } from '@everworker/oneringai';

const routine = createRoutineDefinition({
  name: 'Research Report',
  tasks: [
    {
      name: 'Research',
      description: 'Search for information about quantum computing',
      suggestedTools: ['web_search'],
      validation: {
        completionCriteria: ['At least 3 sources found', 'Key findings stored in memory'],
      },
    },
    {
      name: 'Write Report',
      description: 'Write a report based on research findings',
      dependsOn: ['Research'],
      validation: {
        completionCriteria: ['Report has introduction and conclusion', 'Sources are cited'],
      },
    },
  ],
});

const execution = await executeRoutine({
  definition: routine,
  connector: 'openai',
  model: 'gpt-4.1',
  tools: [...searchTools],
  onTaskComplete: (task, exec) => console.log(`[${exec.progress}%] ${task.name} done`),
});

console.log(execution.status); // 'completed' | 'failed'
```

**Key Features:**
- **Task Dependencies** - DAG-based ordering via `dependsOn`
- **Memory Bridging** - Whiteboard (`store_set("whiteboard", ...)`) + notes (`store_set("notes", ...)`) persist across tasks while conversation is cleared
- **LLM Validation** - Self-reflection against completion criteria with configurable score thresholds
- **Retry Logic** - Configurable `maxAttempts` per task with automatic retry on validation failure
- **Smart Error Classification** - Permanent errors (auth, config, model-not-found) skip retry; transient errors retry normally
- **Control Flow** - `map`, `fold`, and `until` flows with optional per-iteration timeout (`iterationTimeoutMs`)
- **Progress Tracking** - Real-time callbacks and progress percentage
- **Failure Modes** - `fail-fast` (default) or `continue` for independent tasks
- **Custom Prompts** - Override system, task, or validation prompts
- **`ROUTINE_KEYS` export** - Well-known ICM/WM key constants for custom integrations

**Control Flow with Timeout:**

```typescript
const routine = createRoutineDefinition({
  name: 'Process Batch',
  tasks: [{
    name: 'Process Each',
    description: 'Process each item',
    controlFlow: {
      type: 'map',
      source: '__items',
      resultKey: '__results',
      iterationTimeoutMs: 60000, // 1 min per item
      tasks: [{ name: 'Process', description: 'Handle the current item' }],
    },
  }],
});
```

**Execution Recording:** Persist full execution history (steps, task snapshots, progress) with `createExecutionRecorder()`. Replaces ~140 lines of manual hook wiring with a single factory call:

```typescript
import {
  createRoutineExecutionRecord, createExecutionRecorder,
  type IRoutineExecutionStorage,
} from '@everworker/oneringai';

const record = createRoutineExecutionRecord(definition, 'openai', 'gpt-4.1');
const execId = await storage.insert(userId, record);
const recorder = createExecutionRecorder({ storage, executionId: execId });

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

**Scheduling & Triggers:** Run routines on a timer or from external events:

```typescript
import { SimpleScheduler, EventEmitterTrigger } from '@everworker/oneringai';

// Schedule: run every hour
const scheduler = new SimpleScheduler();
scheduler.schedule('hourly-report', { intervalMs: 3600000 }, () => executeRoutine({ definition, agent }));

// Event trigger: run from webhook
const trigger = new EventEmitterTrigger();
trigger.on('new-order', (payload) => executeRoutine({ definition, agent, inputs: payload }));
// In your webhook handler:
trigger.emit('new-order', { orderId: '123' });
```

**Routine Persistence:** Save and load routine definitions with `FileRoutineDefinitionStorage` (or implement `IRoutineDefinitionStorage` for custom backends). Per-user isolation via optional `userId`. Integrated into `StorageRegistry` as `routineDefinitions`.

```typescript
import { createFileRoutineDefinitionStorage, createRoutineDefinition } from '@everworker/oneringai';

const storage = createFileRoutineDefinitionStorage();
const routine = createRoutineDefinition({ name: 'Daily Report', description: '...', tasks: [] });
await storage.save(undefined, routine);  // undefined = default user
const loaded = await storage.load(undefined, routine.id);
const all = await storage.list(undefined, { tags: ['daily'] });
```

> See the [User Guide](./USER_GUIDE.md#routine-execution) for the complete API reference, architecture details, and examples.

### 22. External API Integration

Connect your AI agents to 50 external services with enterprise-grade resilience:

```typescript
import { Connector, ConnectorTools, Services, Agent } from '@everworker/oneringai';

// Create a connector for an external service
Connector.create({
  name: 'github',
  serviceType: Services.Github,
  auth: { type: 'api_key', apiKey: process.env.GITHUB_TOKEN! },
  baseURL: 'https://api.github.com',

  // Enterprise resilience features
  timeout: 30000,
  retry: { maxRetries: 3, baseDelayMs: 1000 },
  circuitBreaker: { enabled: true, failureThreshold: 5 },
});

// Generate tools from the connector
// GitHub connectors get 8 dedicated tools + generic API automatically:
// search_files, search_code, read_file, list_branches, get_pr, pr_files, pr_comments, create_pr
const tools = ConnectorTools.for('github');

// Use with an agent — userId flows to all tools automatically
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'user-123',  // All tool API calls use this user's OAuth tokens
  tools: tools,
});

await agent.run('Find all TypeScript files in src/ and show me the entry point');
await agent.run('Show me PR #42 and summarize the review comments');
```

**Supported Services (50):**
- **Communication**: Slack *(10 built-in tools)*, Telegram *(6 built-in tools)*, Twilio *(4 built-in tools)*, Discord (generic API only), Zoom *(3 built-in tools)*
- **Development**: GitHub *(8 built-in tools)*, GitLab, Jira, Linear, Bitbucket
- **Google Workspace**: Google APIs *(11 built-in tools)* — Gmail, Calendar, Meet transcripts, Drive
- **Microsoft**: Microsoft Graph *(11 built-in tools)* — email, calendar, meetings, Teams transcripts, OneDrive
- **Productivity**: Notion, Asana, Airtable, Trello
- **CRM**: Salesforce, HubSpot, Zendesk, Intercom
- **Payments**: Stripe, PayPal, QuickBooks, Ramp
- **Cloud**: AWS, Cloudflare
- And more...

**Enterprise Features:**
- 🔄 **Automatic retry** with exponential backoff
- ⚡ **Circuit breaker** for failing services
- ⏱️ **Configurable timeout**
- 📊 **Metrics tracking** (requests, latency, success rate)
- 🔐 **Protected auth headers** (cannot be overridden)

```typescript
// Direct fetch with connector
const connector = Connector.get('github');
const data = await connector.fetchJSON('/repos/owner/repo/issues');

// Metrics
const metrics = connector.getMetrics();
console.log(`Success rate: ${metrics.successCount / metrics.requestCount * 100}%`);
```

#### Scoped Connector Registry

Limit connector visibility by user, group, or tenant in multi-user systems:

```typescript
import { Connector, ScopedConnectorRegistry } from '@everworker/oneringai';
import type { IConnectorAccessPolicy } from '@everworker/oneringai';

// Define an access policy
const policy: IConnectorAccessPolicy = {
  canAccess: (connector, context) => {
    const tags = connector.config.tags as string[] | undefined;
    return !!tags && tags.includes(context.tenantId as string);
  },
};

// Set the global policy
Connector.setAccessPolicy(policy);

// Create a scoped view for a specific tenant
const registry = Connector.scoped({ tenantId: 'acme-corp' });

// Only connectors tagged with 'acme-corp' are visible
registry.list();           // ['acme-openai', 'acme-slack']
registry.get('other-co');  // throws "not found" (no info leakage)

// Use with Agent
const agent = Agent.create({
  connector: 'acme-openai',
  model: 'gpt-4.1',
  registry,  // Agent resolves connectors through the scoped view
});

// Use with ConnectorTools
const tools = ConnectorTools.for('acme-slack', undefined, { registry });
const allTools = ConnectorTools.discoverAll(undefined, { registry });
```

**Features:**
- Pluggable `IConnectorAccessPolicy` interface — bring your own access logic
- Opaque context object (`{ userId, tenantId, roles, ... }`) — library imposes no structure
- Denied connectors get the same "not found" error — no information leakage
- Zero changes to existing API — scoping is entirely opt-in
- Works with `Agent.create()`, `ConnectorTools.for()`, and `ConnectorTools.discoverAll()`

#### Vendor Templates

Quickly set up connectors for 50 services with pre-configured authentication templates:

```typescript
import {
  createConnectorFromTemplate,
  listVendors,
  getVendorTemplate,
  ConnectorTools
} from '@everworker/oneringai';

// List all available vendors
const vendors = listVendors();
// [{ id: 'github', name: 'GitHub', authMethods: ['pat', 'oauth-user', 'github-app'], ... }]

// Create connector from template (just provide credentials!)
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

**Supported Categories (50 vendors):**
| Category | Vendors |
|----------|---------|
| Major vendors | Microsoft, Google Workspace |
| Communication | Slack, Discord, Telegram, X (Twitter), Zoom, HeyReach |
| Development | GitHub, GitLab, Bitbucket, Jira, Linear, Asana, Trello |
| Productivity | Notion, Airtable, Confluence, Cal.com, Calendly |
| CRM | Salesforce, HubSpot, Pipedrive |
| Payments | Stripe, PayPal, QuickBooks, Ramp |
| Cloud | AWS, Cloudflare |
| Storage | Dropbox, Box |
| Email | SendGrid, Mailchimp, Postmark, Mailgun, EmailBison |
| Monitoring | Datadog, PagerDuty, Sentry |
| Search | Serper, Brave Search, Tavily, RapidAPI Web Search |
| Scrape | ZenRows |
| Other | Twilio, Zendesk, Intercom, Shopify, ipinfo, Clay |

Each vendor includes:
- **Credentials setup URL** - Direct link to where you create API keys
- **Multiple auth methods** - API keys, OAuth, service accounts
- **Pre-configured URLs** - Authorization, token endpoints pre-filled
- **Common scopes** - Recommended scopes for each auth method

See the [User Guide](./USER_GUIDE.md#vendor-templates) for complete vendor reference.

**Vendor Logos:**
```typescript
import { getVendorLogo, getVendorLogoSvg, getVendorColor } from '@everworker/oneringai';

// Get logo with metadata
const logo = getVendorLogo('github');
if (logo) {
  console.log(logo.svg);           // SVG content
  console.log(logo.hex);           // Brand color: "181717"
  console.log(logo.isPlaceholder); // false (has official icon)
}

// Get just the SVG (with optional color override)
const svg = getVendorLogoSvg('slack', 'FFFFFF');  // White icon

// Get brand color
const color = getVendorColor('stripe');  // "635BFF"
```

#### Tool Discovery with ToolRegistry

For UIs or tool inventory, use `ToolRegistry` to get all available tools:

```typescript
import { ToolRegistry } from '@everworker/oneringai';

const allTools = ToolRegistry.getAllTools();

for (const tool of allTools) {
  if (ToolRegistry.isConnectorTool(tool)) {
    console.log(`API: ${tool.displayName} (${tool.connectorName})`);
  } else {
    console.log(`Built-in: ${tool.displayName}`);
  }
}
```

### 23. Microsoft Graph Connector Tools

11 dedicated tools for Microsoft Graph API — email, calendar, meetings, Teams transcripts, and OneDrive/SharePoint files. Auto-registered for connectors with `serviceType: 'microsoft'` or `baseURL` matching `graph.microsoft.com`.

```typescript
import { Connector, ConnectorTools, Services, Agent } from '@everworker/oneringai';

// Create a Microsoft connector (OAuth required for most operations)
Connector.create({
  name: 'microsoft',
  serviceType: Services.Microsoft,
  auth: { type: 'oauth', /* ... OAuth config ... */ },
  baseURL: 'https://graph.microsoft.com/v1.0',
});

// Get all Microsoft tools (generic API + 11 dedicated tools)
const tools = ConnectorTools.for('microsoft');

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  tools,
});

await agent.run('Draft an email to alice@example.com about the project update');
await agent.run('Schedule a 30-minute meeting with bob@example.com next Tuesday at 2pm');
await agent.run('Find available meeting slots for alice and bob this week');
```

**Tools:**
| Tool | Description | Risk |
|------|-------------|------|
| `create_draft_email` | Create a draft email or reply draft | medium |
| `send_email` | Send an email or reply immediately | medium |
| `create_meeting` | Create calendar event with optional Teams link | medium |
| `edit_meeting` | Update an existing calendar event | medium |
| `get_meeting` | Get full details of a single calendar event | low |
| `list_meetings` | List calendar events in a time window | low |
| `find_meeting_slots` | Find available slots when all attendees are free | low |
| `get_meeting_transcript` | Retrieve Teams meeting transcript as text | low |
| `read_file` | Read a OneDrive/SharePoint file as markdown | low |
| `list_files` | List files/folders in OneDrive/SharePoint | low |
| `search_files` | Search across OneDrive/SharePoint | low |

Supports both **delegated** (`/me` — user signs in) and **application** (`/users/{id}` — app-only) permission modes. See the [User Guide](./USER_GUIDE.md#microsoft-graph-connector-tools) for full parameter reference.

### 24. Tool Catalog

When agents have 100+ available tools, sending all definitions to the LLM wastes tokens and degrades performance. The Tool Catalog lets agents discover and load only the categories they need:

```typescript
import { Agent, ToolCatalogRegistry } from '@everworker/oneringai';

// Register custom categories (built-in tools auto-register)
ToolCatalogRegistry.registerCategory({
  name: 'knowledge',
  displayName: 'Knowledge Graph',
  description: 'Search entities, get facts, manage references',
});
ToolCatalogRegistry.registerTools('knowledge', [
  { name: 'entity_search', displayName: 'Entity Search', description: 'Search entities', tool: entitySearchTool, safeByDefault: true },
]);

// Enable tool catalog with scoping
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  // Identities control which connector categories are visible
  identities: [{ connector: 'github' }, { connector: 'slack' }],
  context: {
    features: { toolCatalog: true },
    toolCategories: ['filesystem', 'knowledge'],  // scope for built-in categories
    plugins: {
      toolCatalog: {
        pinned: ['filesystem'],       // always loaded, LLM can't unload
        autoLoadCategories: ['knowledge'],  // pre-loaded, LLM can unload
      },
    },
  },
});

// Agent gets 3 metatools: tool_catalog_search, tool_catalog_load, tool_catalog_unload
// It can browse categories, load what it needs, and unload when done
await agent.run('Search for information about quantum computing');
```

**Key Features:**
- **Dynamic loading** — Agent loads only needed categories, saving token budget
- **Pinned categories** — Always-loaded categories that the LLM cannot unload
- **Dual scoping** — `toolCategories` scopes built-in categories, `identities` scopes connector categories
- **Dynamic instructions** — LLM sees exactly which categories are available, with `[PINNED]` markers
- **Connector discovery** — Connector tools auto-discovered as categories, filtered by `identities`
- **Registry API** — `ToolCatalogRegistry.resolveTools()` for app-level tool resolution

See the [User Guide](./USER_GUIDE.md#tool-catalog-dynamic-tool-loadingunloading) for full documentation.

### 25. Async (Non-Blocking) Tools

Some tools take seconds or minutes to complete (web scraping, data analysis, API calls). With async tools, the agent doesn't wait — it continues reasoning and receives results later:

```typescript
import { Agent, ToolFunction } from '@everworker/oneringai';

// Define a long-running tool as non-blocking
const analyzeData: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'analyze_dataset',
      description: 'Run statistical analysis on a dataset (takes ~30s)',
      parameters: {
        type: 'object',
        properties: { dataset: { type: 'string' } },
        required: ['dataset'],
      },
    },
    blocking: false, // <-- This makes it async
  },
  execute: async (args) => {
    // Long-running work happens here
    const result = await runAnalysis(args.dataset);
    return { summary: result.summary, score: result.score };
  },
};

// Auto-continue mode (default): agent handles everything
const agent = Agent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  asyncTools: {
    autoContinue: true,     // Re-enter agentic loop when results arrive (default)
    batchWindowMs: 1000,    // Batch results arriving within 1s (default: 500ms)
    asyncTimeout: 300000,   // 5 min timeout per async tool (default)
  },
  tools: [analyzeData, readFile], // Mix async and blocking tools
});

const response = await agent.run('Analyze the sales dataset and summarize');
// response.pendingAsyncTools lists any still-running async tools
// When results arrive, agent auto-continues and processes them

// Manual mode: caller controls when to continue
const agent2 = Agent.create({
  connector: 'anthropic',
  model: 'claude-sonnet-4-6',
  asyncTools: { autoContinue: false },
  tools: [analyzeData],
});

agent2.on('async:tool:complete', (event) => {
  console.log(`${event.toolName} finished in ${event.duration}ms`);
});

const response2 = await agent2.run('Analyze the dataset');
if (agent2.hasPendingAsyncTools()) {
  // Do other work while waiting, then:
  const continuation = await agent2.continueWithAsyncResults();
  console.log(continuation.output_text);
}
```

**How It Works:**
1. LLM calls a `blocking: false` tool
2. Tool starts executing in background; LLM gets placeholder: *"Tool is executing asynchronously..."*
3. Agentic loop continues — LLM can call other tools, reason, or produce text
4. When the real result arrives, it's injected as a user message with the full result
5. If `autoContinue: true`, the agent re-enters the agentic loop to process the result

**Key Features:**
- **Mixed execution** — Blocking and async tools work together in the same iteration
- **Result batching** — Multiple async results arriving close together are delivered in one message
- **Timeout protection** — Configurable per-tool timeout (default 5 min)
- **5 events** — `async:tool:started`, `async:tool:complete`, `async:tool:error`, `async:tool:timeout`, `async:continuation:start`
- **Public API** — `hasPendingAsyncTools()`, `getPendingAsyncTools()`, `cancelAsyncTool(id)`, `cancelAllAsyncTools()`
- **Clean cleanup** — `agent.destroy()` cancels all pending async tools

See the [User Guide](./USER_GUIDE.md#async-non-blocking-tools) for the full guide.

### 26. Long-Running Sessions (Suspend/Resume)

Some workflows span hours or days — an agent sends an email, then waits for a reply. With `SuspendSignal`, tools can pause the agent loop, and external events resume it later:

```typescript
import { Agent, SuspendSignal, ToolFunction } from '@everworker/oneringai';

// Tool that suspends the agent loop
const presentToUser: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'send_results_email',
      description: 'Email analysis results to the user and wait for their reply',
      parameters: {
        type: 'object',
        properties: { to: { type: 'string' }, body: { type: 'string' } },
        required: ['to', 'body'],
      },
    },
  },
  execute: async (args) => {
    const { messageId } = await emailService.send(args.to, args.body);
    return SuspendSignal.create({
      result: `Email sent to ${args.to}. Waiting for reply.`,
      correlationId: `email:${messageId}`,
      metadata: { messageId },
    });
  },
};

// Run agent — it suspends when the tool returns SuspendSignal
const response = await agent.run('Analyze data and email results to user@example.com');
// response.status === 'suspended'
// response.suspension.correlationId === 'email:msg_123'
// response.suspension.sessionId — saved automatically

// --- Days later: email reply arrives via webhook ---

// Resolve which session to resume
const ref = await correlationStorage.resolve('email:msg_123');

// Reconstruct agent from stored definition + session
const resumedAgent = await Agent.hydrate(ref.sessionId, { agentId: ref.agentId });

// Customize before running (add hooks, tools, etc.)
resumedAgent.tools.register(presentToUser);

// Continue with user's reply — may complete or suspend again!
const result = await resumedAgent.run('Thanks, but also look at Q2 data');
```

**How It Works:**
1. Tool returns `SuspendSignal.create({ result, correlationId })` instead of a normal result
2. Agent loop adds the `result` as normal tool output, does a final wrap-up LLM call (no tools)
3. Session is saved automatically; correlation mapping stored for routing
4. `AgentResponse` has `status: 'suspended'` with full `suspension` metadata
5. Later, `Agent.hydrate()` reconstructs from stored definition + session
6. Caller customizes (hooks, tools), then `run(input)` continues the loop

**Key Features:**
- **Zero LLM awareness** — The LLM just calls tools; suspension is handled by the loop
- **Multi-step workflows** — Resume can lead to another suspension (natural chains)
- **Configurable TTL** — Default 7 days, per-signal via `ttl` option
- **Correlation storage** — Pluggable via `StorageRegistry.set('correlations', myStorage)`
- **Full state restoration** — Conversation history + all plugin states (memory, instructions, etc.)

See the [User Guide](./USER_GUIDE.md#long-running-sessions-suspendresume) for the full guide.

### 27. Agent Registry

Every `Agent` automatically registers with `AgentRegistry` on creation and unregisters on destroy. Query, inspect, and control all agents from one place:

```typescript
import { Agent, AgentRegistry } from '@everworker/oneringai';

// Agents auto-register — no setup needed
const researcher = Agent.create({ connector: 'openai', model: 'gpt-4.1', name: 'researcher' });
const coder = Agent.create({ connector: 'anthropic', model: 'claude-sonnet-4-6', name: 'coder' });

// Query
AgentRegistry.count;                          // 2
AgentRegistry.getByName('researcher');         // [researcher]
AgentRegistry.filter({ status: 'idle' });     // [researcher, coder]

// Aggregate stats
AgentRegistry.getStats();
// { total: 2, byStatus: { idle: 2, ... }, byModel: { 'gpt-4.1': 1, ... }, ... }

// Deep inspection — full context, conversation, plugins, tools, metrics
const inspection = await AgentRegistry.inspect(researcher.registryId);
// inspection.context.plugins     — all plugin states (working memory, etc.)
// inspection.context.tools       — all registered tools with call counts
// inspection.conversation        — full InputItem[] array
// inspection.execution.metrics   — tokens, tool calls, errors, durations

// Parent/child hierarchy (for agent-spawns-agent patterns)
const child = Agent.create({
  connector: 'openai', model: 'gpt-4.1',
  parentAgentId: researcher.registryId,   // link to parent
});
AgentRegistry.getChildren(researcher.registryId);  // [child]
AgentRegistry.getTree(researcher.registryId);      // recursive tree

// Event fan-in — all events from all agents through one listener
AgentRegistry.onAgentEvent((agentId, name, event, data) => {
  console.log(`[${name}] ${event}`);  // "[researcher] execution:start"
});

// External control
AgentRegistry.pauseAgent(researcher.registryId);
AgentRegistry.cancelAll('shutting down');
AgentRegistry.destroyMatching({ model: 'gpt-4.1' });
```

See the [User Guide](./USER_GUIDE.md#agent-registry) for the full API reference.

### 28. Agent Orchestrator

Create autonomous agent teams with conversational delegation and shared workspace:

```typescript
import { createOrchestrator, Connector, Vendor } from '@everworker/oneringai';

Connector.create({ name: 'openai', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! } });

const orchestrator = await createOrchestrator({
  connector: 'openai',
  model: 'gpt-4.1',
  agentTypes: {
    architect: {
      systemPrompt: 'You are a senior software architect.',
      description: 'Senior architect who designs clean, scalable systems',
      scenarios: ['designing new modules', 'reviewing architecture'],
      capabilities: ['read/write files', 'system design'],
      tools: [readFile, writeFile],
    },
    developer: {
      systemPrompt: 'You are a senior developer.',
      description: 'Developer who writes clean, tested code',
      tools: [readFile, writeFile, editFile, bash],
    },
  },
  tools: [readFile],  // Direct tools for the orchestrator itself
});

const result = await orchestrator.run('Build an auth module with JWT support');
```

**How it works:**
- 3-tier routing: DIRECT (orchestrator handles), DELEGATE (hand session to sub-agent), ORCHESTRATE (multi-agent)
- Workers are persistent Agent instances that remember reasoning across turns
- All agents share a workspace (bulletin board) for artifacts and status
- `delegate_interactive` hands the user-facing session to a sub-agent with monitoring and auto-reclaim

**Orchestration tools:**

| Tool | Purpose |
|------|---------|
| `assign_turn(agent, type, instruction)` | Assign work (auto-creates agent if needed, always async, optional autoDestroy) |
| `delegate_interactive(agent, type?, briefing?)` | Hand user session to a sub-agent with monitoring/reclaim |
| `send_message(agent, message)` | Inject message into running/idle agent |
| `list_agents()` | See team status + delegation state |
| `destroy_agent(name)` | Remove a worker (auto-reclaims if delegated) |

See the [User Guide](./USER_GUIDE.md#agent-orchestrator) for detailed examples including delegation, parallel research, and custom workflows.

### 29. Telegram Connector Tools

6 tools for Telegram Bot API, auto-registered via `ConnectorTools.for('telegram')`:

```typescript
import { createConnectorFromTemplate } from '@everworker/oneringai';

createConnectorFromTemplate('my-bot', 'telegram', 'bot-token', {
  apiKey: process.env.TELEGRAM_BOT_TOKEN!,
});

// Tools auto-available when agent has a telegram connector identity:
// telegram_send_message, telegram_send_photo, telegram_get_updates,
// telegram_set_webhook, telegram_get_me, telegram_get_chat
```

### 30. Twilio Connector Tools

4 tools for SMS and WhatsApp via Twilio, auto-registered via `ConnectorTools.for('twilio')`:

```typescript
import { createConnectorFromTemplate } from '@everworker/oneringai';

createConnectorFromTemplate('my-twilio', 'twilio', 'api-key', {
  apiKey: process.env.TWILIO_AUTH_TOKEN!,
  accountId: process.env.TWILIO_ACCOUNT_SID!,
}, { vendorOptions: { defaultFromNumber: '+15551234567' } });

// Tools: send_sms, send_whatsapp, list_messages, get_message
```

### 31. Google Workspace Connector Tools

11 tools for Google APIs (Gmail, Calendar, Meet, Drive), auto-registered via `ConnectorTools.for('google-api')`:

```typescript
import { Connector, Agent, Vendor, ConnectorTools } from '@everworker/oneringai';

// OAuth connector for Google
Connector.create({
  name: 'google',
  vendor: Vendor.Google,
  baseURL: 'https://www.googleapis.com',
  auth: {
    type: 'oauth', flow: 'authorization_code',
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: 'http://localhost:3000/callback',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly',
  },
  config: { serviceType: 'google-api' },
});

// All 11 tools auto-available:
// create_draft_email, send_email, create_meeting, edit_meeting,
// get_meeting, list_meetings, find_meeting_slots, get_meeting_transcript,
// read_file, list_files, search_files
const tools = ConnectorTools.for('google');
```

| Tool | Purpose | Risk |
|------|---------|------|
| `create_draft_email` | Create Gmail draft (or reply draft) | medium |
| `send_email` | Send email or reply via Gmail | medium |
| `create_meeting` | Create Calendar event with optional Meet link | medium |
| `edit_meeting` | Update existing Calendar event | medium |
| `get_meeting` | Get full details of a calendar event | low |
| `list_meetings` | List calendar events in time window | low |
| `find_meeting_slots` | Find free slots via freeBusy API | low |
| `get_meeting_transcript` | Get Meet transcript from Drive | low |
| `read_file` | Read Drive file as markdown | low |
| `list_files` | List Drive files/folders | low |
| `search_files` | Full-text search across Drive | low |

### 32. Zoom Connector Tools

3 tools for Zoom meeting management, auto-registered via `ConnectorTools.for('zoom')`:

```typescript
import { createConnectorFromTemplate, ConnectorTools } from '@everworker/oneringai';

createConnectorFromTemplate('my-zoom', 'zoom', 'oauth-user', {
  clientId: process.env.ZOOM_CLIENT_ID!,
  redirectUri: 'http://localhost:3000/callback',
});

// Tools: zoom_create_meeting, zoom_update_meeting, zoom_get_transcript
const tools = ConnectorTools.for('my-zoom');
```

### 33. Unified Calendar

Cross-provider meeting slot finder — aggregates busy intervals from Google + Microsoft calendars:

```typescript
import { tools } from '@everworker/oneringai';

const tool = tools.createUnifiedFindMeetingSlotsTool([
  tools.createGoogleCalendarSlotsProvider(googleConnector),
  tools.createMicrosoftCalendarSlotsProvider(msftConnector),
]);

const result = await tool.execute({
  attendees: ['alice@gmail.com', 'bob@outlook.com'],
  startDateTime: '2026-04-15T08:00:00',
  endDateTime: '2026-04-15T18:00:00',
  duration: 30,
});
// Returns: slots where ALL attendees across ALL providers are free
```

### 34. Multi-Account Connectors

Use multiple accounts per connector (e.g., work + personal Microsoft accounts):

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
// Each identity generates its own set of account-prefixed tools.
// toolFilter restricts which tools are created per identity.
```

### 35. Integration Testing

Reusable test suite framework for validating connector tools against live APIs:

```typescript
import { IntegrationTestRunner } from '@everworker/oneringai';

// List all available suites (16 total)
const suites = IntegrationTestRunner.getAllSuites();
// → google-workspace, microsoft-365, slack, github, telegram, twilio, zoom,
//   generic-api, plus 4 web-search-* and 4 web-scrape-* provider variants

// Run a suite: select the suite object, then pass tools and a flat params map
const googleSuite = suites.find((suite) => suite.id === 'google-workspace');
if (!googleSuite) throw new Error('Google Workspace suite not registered');

const result = await IntegrationTestRunner.runSuite(googleSuite, connectorTools, {
  testRecipientEmail: 'test@example.com',
});
```

### 36. Instruction Templates

Use `{{COMMAND}}` placeholders in agent instructions that resolve automatically — static values at creation, dynamic values every LLM call. Fully extensible with custom handlers:

```typescript
import { Agent, TemplateEngine } from '@everworker/oneringai';

// Built-in templates resolve automatically
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  instructions: `You are {{AGENT_NAME}}, running on {{VENDOR}}/{{MODEL}}.
Today is {{DATE}}. Current time: {{TIME:HH:mm}}.
Your session ID is {{RANDOM:1000:9999}}.`,
});

// Register custom handlers — override built-ins or add your own
TemplateEngine.register('COMPANY', () => 'Acme Corp');
TemplateEngine.register('DATE', (fmt, ctx) => {
  // Override built-in DATE with user-timezone support
  const tz = (ctx.timezone as string) ?? 'UTC';
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}, { dynamic: true });

// Async handlers for dynamic data
TemplateEngine.register('USER_COUNT', async () => {
  return String(await db.users.countDocuments());
}, { dynamic: true });

// Escape templates to pass them literally to the LLM:
// Triple braces: {{{DATE}}} → {{DATE}}
// Raw blocks:    {{raw}}...{{/raw}} → content verbatim
```

**Built-in handlers:** `DATE`, `TIME`, `DATETIME` (with format args like `MM/DD/YYYY`), `RANDOM:min:max`, `AGENT_ID`, `AGENT_NAME`, `MODEL`, `VENDOR`, `USER_ID`

See the [User Guide](./USER_GUIDE.md#instruction-templates) for the full reference.

---

## MCP (Model Context Protocol) Integration

Connect to MCP servers for automatic tool discovery and seamless integration:

```typescript
import { MCPRegistry, Agent, Connector, Vendor } from '@everworker/oneringai';

// Setup authentication
Connector.create({
  name: 'openai',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

// Connect to local MCP server (stdio)
const fsClient = MCPRegistry.create({
  name: 'filesystem',
  transport: 'stdio',
  transportConfig: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
  },
});

// Connect to remote MCP server (HTTP/HTTPS)
const remoteClient = MCPRegistry.create({
  name: 'remote-api',
  transport: 'https',
  transportConfig: {
    url: 'https://mcp.example.com/api',
    token: process.env.MCP_TOKEN,
  },
});

// Connect and discover tools
await fsClient.connect();
await remoteClient.connect();

// Create agent and register MCP tools
const agent = Agent.create({ connector: 'openai', model: 'gpt-4.1' });
fsClient.registerTools(agent.tools);
remoteClient.registerTools(agent.tools);

// Agent can now use tools from both MCP servers!
await agent.run('List files and analyze them');
```

**Features:**
- 🔌 **Stdio & HTTP/HTTPS transports** - Local and remote server support
- 🔍 **Automatic tool discovery** - Tools are discovered and registered automatically
- 🏷️ **Namespaced tools** - `mcp:{server}:{tool}` prevents conflicts
- 🔄 **Auto-reconnect** - Exponential backoff with configurable retry
- 📊 **Session management** - Persistent connections with session IDs
- 🔐 **Permission integration** - All MCP tools require user approval
- ⚙️ **Configuration file** - Declare servers in `oneringai.config.json`

**Available MCP Servers:**
- [@modelcontextprotocol/server-filesystem](https://github.com/modelcontextprotocol/servers) - File system access
- [@modelcontextprotocol/server-github](https://github.com/modelcontextprotocol/servers) - GitHub API
- [@modelcontextprotocol/server-google-drive](https://github.com/modelcontextprotocol/servers) - Google Drive
- [@modelcontextprotocol/server-slack](https://github.com/modelcontextprotocol/servers) - Slack integration
- [@modelcontextprotocol/server-postgres](https://github.com/modelcontextprotocol/servers) - PostgreSQL database
- [And many more...](https://github.com/modelcontextprotocol/servers)

See [MCP_INTEGRATION.md](./MCP_INTEGRATION.md) for complete documentation.

## Examples

See the **[complete examples guide](https://github.com/aantich/oneringai/blob/main/examples/README.md)** for every runnable program, its purpose, required credentials, side effects, and exact command.

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

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test

# Type check
npm run typecheck
```

## Architecture

The library uses **Connector-First Architecture**:

```
User Code → Connector Registry → Agent → Provider → LLM
```

**Benefits:**
- ✅ Single source of truth for authentication
- ✅ Multiple keys per vendor
- ✅ Named connectors for easy reference
- ✅ No API key management in agent code
- ✅ Same pattern for AI providers AND external APIs
- ✅ Scoped registry for multi-tenant access control

## Troubleshooting

### "Connector not found"
Make sure you created the connector with `Connector.create()` before using it.

### "Invalid API key"
Check your `.env` file and ensure the key is correct for that vendor.

### "Model not found"
Each vendor has different model names. Check the [User Guide](./USER_GUIDE.md) for supported models.

### Vision not working
Use a current vision-capable model: `gpt-6.1-sol`, `claude-opus-5-5`, or
`gemini-3.8-flash`.

## Contributing

Contributions are welcome! Please see our [Contributing Guide](./CONTRIBUTING.md).

## License

MIT License - See [LICENSE](./LICENSE) file.

---

**Version:** 1.2.0 | **Last Updated:** 2026-10-07 | **[User Guide](./USER_GUIDE.md)** | **[API Reference](./API_REFERENCE.md)** | **[Changelog](./CHANGELOG.md)**
