# OneRingAI Agent Guide

This is the canonical, vendor-neutral guide for coding agents that use or
modify `@everworker/oneringai`. It is written for OpenAI Codex, Claude Code,
custom coding agents, and humans delegating integration work to them.

Read this file before generating OneRingAI code. For exhaustive detail, follow
the documentation links near the end instead of guessing an API.

## Fast facts

- Package: `@everworker/oneringai`
- Runtime: Node.js 22.13+ or 24+
- Language: strict TypeScript
- Package format: ESM with ESM and CJS build outputs
- Public API: import from `@everworker/oneringai` unless a documented subpath is
  explicitly required
- Architecture: connector-first, plugin-first context, one shared tool manager

## Determine your operating mode

### Using OneRingAI as a dependency

- Import only from the package's public exports.
- Do not import `src/**`, `dist/**`, or undocumented implementation paths.
- Read the installed package's `README.md`, `AGENTS.md`, `USER_GUIDE.md`, and
  `API_REFERENCE.md` when they are available under
  `node_modules/@everworker/oneringai/`.
- Prefer runnable patterns from `examples/` in the repository over invented
  method names or provider-specific SDK calls.

### Modifying the OneRingAI repository

- Preserve the connector-first and plugin-first invariants below.
- Relative TypeScript imports include the `.js` extension.
- Use `export type { X }` for types and `export { X }` for runtime values.
- Use errors from `src/domain/errors/AIErrors.ts` where applicable.
- Do not hand-edit generated registries. Run the relevant generator.
- Keep changes focused and validate them with the commands at the end.

## The mental model

```text
Application
  -> named Connector (credentials + service identity)
  -> Agent (model + instructions + tools + context)
  -> provider implementation

AgentContextNextGen
  -> context plugins (state, memory, catalog, workspace)
  -> one ToolManager shared by agent and context
  -> compaction and persistence
```

Non-negotiable rules:

1. `Connector` is the single source of truth for authentication.
2. Connectors are named so multiple accounts or keys can coexist.
3. AI-provider connectors declare an explicit `Vendor`; do not infer a vendor
   from a model string.
4. External-service connectors use `serviceType` and may expose tools through
   `ConnectorTools.for(connectorName)`.
5. `agent.tools === agent.context.tools`; do not build a second tool pipeline.
6. Context capabilities are plugins. Disabled features add no prompt content
   or tools.
7. Use model and capability registries rather than assuming a model supports a
   feature.

## Minimal working agent

```typescript
import { Agent, Connector, Vendor } from '@everworker/oneringai';

Connector.create({
  name: 'openai-main',
  vendor: Vendor.OpenAI,
  auth: {
    type: 'api_key',
    apiKey: process.env.OPENAI_API_KEY!,
  },
});

const instructions = 'Be accurate, concise, and explicit about uncertainty.';

const agent = Agent.create({
  connector: 'openai-main',
  model: 'gpt-5.6-terra',
  instructions,
});

const response = await agent.run('Explain connector-first architecture.');
console.log(response.output_text);
```

Switching providers changes connector and model—not the agent's tools or task
logic:

```typescript
Connector.create({
  name: 'anthropic-main',
  vendor: Vendor.Anthropic,
  auth: { type: 'api_key', apiKey: process.env.ANTHROPIC_API_KEY! },
});

const claudeAgent = Agent.create({
  connector: 'anthropic-main',
  model: 'claude-sonnet-4-6',
  instructions,
});
```

## Choose the right surface

| Goal | Preferred API |
|------|---------------|
| Stateful, tool-using assistant | `Agent.create()` + `agent.run()` |
| Token/event streaming | `agent.stream()` |
| One direct model call without managed context | `agent.runDirect()` / `streamDirect()` |
| Structured JSON | `responseFormat` on `run()` or `runDirect()` |
| Authenticated external API | `Connector` + `ConnectorTools.for()` or `Connector.fetch()` |
| Web search | Serper/Brave/Tavily connector tools or `SearchProvider` |
| Web scraping | ZenRows/Jina/Firecrawl/ScrapingBee connector tools or `ScrapeProvider` |
| Dynamic large tool sets | `ToolCatalogPluginNextGen` via `context.features.toolCatalog` |
| Long-term knowledge | `MemorySystem` and memory context plugins |
| Image generation/editing | `ImageGeneration` |
| Video generation | `VideoGeneration` |
| Text-to-speech / speech-to-text | `TextToSpeech` / `SpeechToText` |
| Embeddings | `Embeddings` |
| Multiple cooperating agents | `createOrchestrator()` |
| External MCP servers | `MCPRegistry` |
| Pre-built OneRingAI or Codex agent runtime | `@everworker/oneringai/agent-runtime`; select `model`/`reasoning`, observe with `run.events()` |

## Connectors and external tools

Create one named connector for each credential/account. Pass connector names,
not service-type names, to agents and tool factories.

```typescript
import {
  Agent,
  Connector,
  ConnectorTools,
  Services,
  Vendor,
  tools,
} from '@everworker/oneringai';

Connector.create({
  name: 'serper-research',
  serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});

Connector.create({
  name: 'zenrows-research',
  serviceType: Services.Zenrows,
  auth: { type: 'api_key', apiKey: process.env.ZENROWS_API_KEY! },
  baseURL: 'https://api.zenrows.com/v1',
});

const researchAgent = Agent.create({
  connector: 'openai-main',
  model: 'gpt-5.6-terra',
  identities: [
    { connector: 'serper-research' },
    { connector: 'zenrows-research' },
  ],
  tools: [
    ...ConnectorTools.for('serper-research'),
    ...ConnectorTools.for('zenrows-research'),
    tools.webFetch,
  ],
});
```

Important distinctions:

- The 50 service templates configure authentication and endpoint defaults.
- A configured connector with `baseURL` gets a generic authenticated API tool.
- Selected services add specialized tools, such as GitHub, Slack, Microsoft,
  Google Workspace, Telegram, Twilio, Zoom, Serper, and ZenRows.
- `identities` limits which connector categories an agent may discover; it is
  not a substitute for host authorization.
- Never place API keys in prompts, tool arguments, or source files.

## Agent execution

- `run(input, options?)` uses managed context, tools, compaction, and plugins.
- `stream(input, options?)` emits typed streaming events.
- `runDirect(input, options?)` bypasses context management for a direct model
  call; tools are excluded unless `includeTools` is enabled.
- `thinking`, `temperature`, and `vendorOptions` are per-call overrides.
- Read text from `response.output_text`. Structured responses also expose
  `output_parsed` after successful coercion.

```typescript
const response = await agent.run('Return the two highest priorities.', {
  responseFormat: {
    type: 'json_schema',
    name: 'priorities',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
});
```

Use `run()` rather than streaming when prompt-fallback structured output and
tools must be combined; the non-streaming path can perform the final repair
pass.

## Tool system

Tools come from five places:

1. Application-supplied `ToolFunction`s.
2. The 39 generated connector-free built-ins in eight populated categories.
3. Context plugins, including `store_*`, `memory_*`, and catalog tools.
4. Connector-generated generic and specialized tools.
5. MCP servers.

Minimal custom tool:

```typescript
import type { ToolFunction } from '@everworker/oneringai';

const getWeather: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
        additionalProperties: false,
      },
    },
  },
  execute: async ({ city }) => ({ city, temperatureC: 21 }),
  describeCall: ({ city }) => `Weather for ${String(city)}`,
};
```

Tool guidance:

- Tool names must be unique within an agent.
- Return serializable data; throw meaningful errors for failed execution.
- Add `describeCall` when a UI should display a human-readable action.
- Use `PermissionPolicyManager` and user rules for destructive or sensitive
  tools. The evaluation order is user rules, parent delegation, then policy
  chain.
- Use the tool catalog for large tool sets instead of sending every definition
  to the model on every turn.
- Use `agent.tools` to register MCP or late-bound tools; do not replace the
  manager.

## Context plugins

`AgentContextNextGen` assembles plugin instructions, plugin content, tools,
conversation history, current input, token accounting, persistence, and
compaction into one model request.

| Feature flag | Default | Purpose |
|--------------|---------|---------|
| `workingMemory` | `true` | External tiered scratch storage |
| `inContextMemory` | `true` | Small high-value state directly in the prompt |
| `persistentInstructions` | `false` | Deprecated keyed instruction store |
| `userInfo` | `false` | Deprecated user store and TODO tools |
| `toolCatalog` | `false` | Discover/load/unload tool categories |
| `sharedWorkspace` | `false` | Versioned multi-agent coordination board |
| `memory` | `false` | Long-term memory injection plus six read tools |
| `memoryWrite` | `false` | Six write tools; requires `memory` |

```typescript
const catalogAgent = Agent.create({
  connector: 'openai-main',
  model: 'gpt-5.6-terra',
  identities: [{ connector: 'serper-research' }],
  context: {
    model: 'gpt-5.6-terra',
    features: { toolCatalog: true },
    toolCategories: ['filesystem', 'web'],
    plugins: {
      toolCatalog: {
        pinned: ['filesystem'],
        autoLoadCategories: ['web'],
      },
    },
  },
});
```

Compaction runs once before the LLM call. Tool-call/result pairs are preserved
or removed together. Do not pre-compact the same turn in application code.

## Long-term memory

The memory layer is a standalone entity/fact knowledge system, not chat history
and not only a vector store. It supports provenance, confidence, importance,
graph traversal, fact and document embeddings, ranked recall, entity
resolution, bitemporal queries, profiles, signal ingestion, and permissions.

The agent integration has 12 tools:

- Six reads: `memory_recall`, `memory_graph`, `memory_search`,
  `memory_search_documents`, `memory_find_entity`, `memory_list_facts`.
- Six writes: `memory_remember`, `memory_link`, `memory_upsert_entity`,
  `memory_forget`, `memory_restore`, `memory_set_agent_rule`.

```typescript
import {
  Agent,
  InMemoryAdapter,
  createMemorySystemWithConnectors,
} from '@everworker/oneringai';

const memory = createMemorySystemWithConnectors({
  store: new InMemoryAdapter(),
  connectors: {
    embedding: {
      connector: 'openai-main',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    },
    profile: {
      connector: 'anthropic-main',
      model: 'claude-sonnet-4-6',
    },
  },
  visibilityPolicy: () => ({ group: 'read', world: 'none' }),
});

const memoryAgent = Agent.create({
  connector: 'anthropic-main',
  model: 'claude-sonnet-4-6',
  userId: 'user-123',
  context: {
    model: 'claude-sonnet-4-6',
    agentId: 'assistant-1',
    features: { memory: true, memoryWrite: true },
    plugins: { memory: { memory } },
  },
});
```

Memory safety rules:

- Every entity and fact needs an owner; pass a trusted `userId`/scope.
- `groupId`, principals, and visibility policy come from the host authorization
  layer, never from LLM-controlled tool arguments.
- The library default is public-read for backwards compatibility. Production
  multi-tenant applications should set an explicit `visibilityPolicy`.
- Prefer retrieval-only agents (`memory: true`) plus
  `SessionIngestorPluginNextGen` when the LLM should not mutate memory.
- Task state changes are host-driven via `transitionTaskState`; do not encode
  state/due dates as parallel facts.
- For Mongo, run adapter and vector-index migration helpers exactly as described
  in `docs/MEMORY_GUIDE.md` and `docs/MEMORY_PERMISSIONS.md`.

## Multimodal and specialized APIs

Use the dedicated high-level class rather than calling vendor SDKs directly:

| Capability | Class / registry |
|------------|------------------|
| Images | `ImageGeneration`, `IMAGE_MODELS` |
| Video | `VideoGeneration`, `VIDEO_MODELS` |
| Text-to-speech | `TextToSpeech`, `TTS_MODELS` |
| Speech-to-text | `SpeechToText`, `STT_MODELS` |
| Embeddings | `Embeddings`, `EMBEDDING_MODELS` |
| Realtime voice agent | `OpenAIRealtimeAgentSession` (Agent lifecycle, context, local tools, hosted MCP) |
| Raw Realtime transport | `OpenAIRealtimeSession` (advanced WebSocket protocol access) |
| Documents | `DocumentReader`, `readDocumentAsContent`, filesystem tools |

Inspect registry metadata for lifecycle, modality, capability, endpoint,
pricing, and replacement information. `isActive` means callable;
`lifecycle` describes recommendation/migration state. Token limits may be
`null`; use `resolveMaxContextTokens()` when a number is required.

## Orchestration and MCP

`createOrchestrator()` returns a regular `Agent` with `SharedWorkspace` and five
tools: `assign_turn`, `delegate_interactive`, `send_message`, `list_agents`, and
`destroy_agent`. `assign_turn` is asynchronous; results arrive as follow-up
messages. Use `delegate_interactive` only when the specialist needs a direct
conversation with the user.

For MCP:

```typescript
import { MCPRegistry } from '@everworker/oneringai';

const client = MCPRegistry.create({
  name: 'filesystem',
  transport: 'stdio',
  transportConfig: { command: 'npx', args: ['-y', 'mcp-server'] },
});

await client.connect();
client.registerTools(agent.tools);
```

Keep MCP clients alive for as long as their tools can execute, and close them
during application shutdown.

## Persistence, tenancy, and cleanup

- Set `userId` on the agent; it flows into tool execution and session metadata.
- Restrict visible external identities with `identities`.
- Configure backend factories through `StorageRegistry` rather than hard-coding
  storage inside plugins.
- Save/load context through `agent.context.save()` and `load()` when sessions
  must survive restarts.
- Call `destroy()` on disposable agents, contexts, plugins, and clients during
  teardown.

## Documentation routing

| Need | Read |
|------|------|
| First integration | `README.md`, then `examples/README.md` |
| Complete usage guide | `USER_GUIDE.md` |
| Public signatures | `API_REFERENCE.md` |
| Connectors and every tool source | `docs/CONNECTOR_TOOL_CATALOG.md` |
| Long-term memory | `docs/MEMORY_GUIDE.md` |
| Memory API / security / predicates / ingestion | `docs/MEMORY_API.md`, `docs/MEMORY_PERMISSIONS.md`, `docs/MEMORY_PREDICATES.md`, `docs/MEMORY_SIGNALS.md` |
| Release migration | `CHANGELOG.md` and the upgrade section in `USER_GUIDE.md` |
| Runnable examples | `examples/README.md` and `examples/*.ts` |
| Pre-built agent runtime usage | `USER_GUIDE.md#agent-runtime-preview` and `examples/agent-runtime-local.ts` |
| Agent runtime architecture and server roadmap | `docs/designs/AGENT_RUNTIME.md` |
| Server/desktop Agent packages, remote tools, and WebRTC ownership | `docs/designs/DISTRIBUTED_AGENT_EXECUTION.md` |

When documentation and source disagree, verify the public export and tests,
then fix the stale documentation in the same change.

## Repository map

```text
src/core/                    Agent, Connector, context, tools, permissions,
                             orchestration, MCP, storage
src/core/context-nextgen/    Context manager and plugins
src/memory/                  Entity/fact memory system and adapters
src/capabilities/            Search, scrape, images, video, speech, embeddings
src/infrastructure/          Providers, resilience, storage implementations
src/tools/                   Built-in and connector tool implementations
src/connectors/              OAuth, vendor templates, connector storage
src/agent-runtime/           Vendor-neutral sessions, local backend, drivers
examples/                    Runnable integration examples
apps/amos/                   Terminal agent reference application
```

## Repository validation

Use the smallest relevant checks while iterating, then broaden in proportion to
risk:

```bash
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run examples:check
```

Integration tests require real credentials and are not the default validation
path. Never add or print secrets to make them pass.

## Final checklist for coding agents

- Did you use a named connector rather than direct SDK credentials?
- Did you use only public package exports in consumer code?
- Did you choose `run`, `stream`, or `runDirect` intentionally?
- Are tools scoped, permissioned, uniquely named, and serializable?
- Are connector identities and memory scope derived from trusted host state?
- Did you avoid deprecated `PersistentInstructions`/`UserInfo` for new designs?
- Did you use registries rather than guessing model capabilities?
- Did you follow the specialist guide for memory, OAuth, or MCP work?
- Did you run the relevant build, type, and test checks?

---

Version: 1.2.0 | Runtime: Node.js 22.13+ or 24+ | Architecture: Connector-first +
NextGen context
