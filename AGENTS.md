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
- Use `agent.tools.executeWithOutcome()` for semantic diagnostics; `execute()`
  preserves raw returns. An application `success: false` field is not a framework
  failure. Observe `ToolContext.signal` and forward it to connector requests.
- Cancellation/timeouts do not establish whether an external write happened.
  Late outcomes retain original call/run IDs and are diagnostic-only. See
  [tool outcomes](docs/TOOL_OUTCOMES_AND_CANCELLATION.md) for defaults, deadlines,
  retry boundaries, and support limitations.
- Invocation connector access and selected tool/permission metadata are captured
  at admission; re-registration affects future calls. Internal background delivery
  checks scope again. Stream counters settle before completion events.
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
| `evidence` | disabled | Scoped evidence, bounded retrieval and opt-in tool projections |
| `taskState` | `false` | Host-controlled task view with revision-checked notes/receipts |

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

Preparation runs one bounded compaction pass before the LLM call, then rebuilds
contributions and counts the sanitized request. Connected tool-call/result groups
are preserved or removed together; pending results and outstanding native async
calls protect their dependencies. Duplicate final results are invalid protocol.
Final dispatch checks cover synchronous request listeners, actual model capacity,
schemas/native tools, and replay signatures. Managed JSON repair checks fit without
replacing the main context diagnostic. Spill stores all connected native/message
results and attachments before removal; failed writes preserve history.
Known request constraints and provider capacity guide the initial compaction pass.
Spill allocation includes already stored keys, including after save/load, and
function-result errors are counted before preparation and dispatch.
Do not pre-compact the same turn in application code. Inspect `lastPreparation`
for the selected revision and estimated budget instead of preparing again.
The notes index and keyless `store_get({ store: "notes" })` contain metadata only.
Retrieve each source with its exact index key, including tier/collision suffix,
before using its contents. `store_list` discovers entries omitted from the index.
See [context preparation](docs/CONTEXT_PREPARATION.md) for fit errors and race handling.

## Durable evidence

Enable `context.features.evidence` explicitly. Use a host-owned stable scope and
`FileEvidenceStorage` (or a custom acknowledged backend) for restart recovery;
the enabled default is a new process-local in-memory store. Keep tenant/owner
selection outside model arguments. `output.summarize` receives a detached redacted
copy; preserve essential IDs/status. Raw tool returns and execution events stay raw.
Inspect `outcome.evidence` independently of execution status. Storage/projection
failure must never trigger repetition of an external action. Unacknowledged raw
results are protected from compaction/truncation/rollover; oversized/async delivery
can stop explicitly. Recover by storing the retained observation, then host-only
`context.acknowledgeToolEvidence(callId, reference)`. Use `evidence_read({ id })` with bounded
offsets and `evidence_list` for omitted references. Read the [evidence guide](docs/DURABLE_EVIDENCE.md)
for scope, JSON limitations, redaction, retention, snapshots, and actual durability.
Authentic deliveries retain recovery correlation when optional `outcome` is omitted.
Protected pending groups survive new/async input and are copied into session snapshots
without committing live input or adding required session fields. Save interrupted
observations before destroying the context; recovery never reruns their action.
Early stream closure and fail-fast exits retain settled unstored batches. A stored
receipt without a result cannot release raw protection, including async delivery.
Loading a checkpoint reconciles matching function/custom call and execution IDs
across receipt changes; the checkpoint owns matching invocations.
Acknowledgement requires a result-bearing record. Failed async delivery retains
queued completions for host repair and explicit continuation. Bundled stores expose
an optional `serializationLimitBytes` hint; configure `maxSerializationBytes` for
custom backends or deliberately larger sources reduced by host redaction. Final
backend quotas still apply; existing adapters need no new required members.

## Explicit helper models and task budgets

Optional `modelExecution.helpers` configures `compactor`, `extractor`, and `verifier`
through named connectors. `agent.invokeHelper(role, textOrBuilder, { schema, modelTask })`
is stateless and tool-free; defaults are 512 output tokens and one local-schema
repair. The main model stays fixed. A configured compactor is used by explicit
between-execution `rolloverContext()` or an explicitly selected
`StructuredSummaryStrategy` during bounded pre-call preparation; transfer to another connector requires
`allowContextTransfer: true`.

Share a host-owned `ModelTask` across managed/direct calls and helpers to share
process-local call/token/deadline/model token-cost reservations. Sharing is
explicit: a helper without `modelTask` owns an independent task even
during another execution. Its schema compiler is scoped to that invocation.
Google GenerateContent/Vertex thinking is inclusive in ledger output/cost counts;
keep the legacy response/event fields intact. Missing/partial external usage
stays unknown, and failed/cancelled outcomes are recorded separately from usage.
Tracked request records are captured before admission. Google/Vertex candidate
count multiplies output reservations and the aggregate per-call cap. Repair keeps
the selected evidence and fails before dispatch on overflow. Mixed external pricing
uncertainty survives final snapshots. Capacity-based reservations can be much larger
than the prompt. Read `task.snapshot()` or
`agent.getModelUsage()` alongside unknown-usage/cost counters; registry costs are
estimates, external fees are excluded. Helpers/tasks are disabled by default;
saved context does not restore task authority or role configuration. See the
[complete recipe](docs/MODEL_TASKS_AND_HELPERS.md) before configuring hard limits,
custom providers, cross-connector history transfer, or external usage reports.

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
| Protected task state, host corrections and pending actions | `docs/TASK_STATE.md` |
| Selective context data, companion registration and cache-aware layout | `docs/CONTEXT_ASSEMBLY.md` |
| Bounded run/stream recovery and host completion checks | `docs/AGENT_LOOP_POLICIES.md` |
| Durable tool evidence, projections and recovery | `docs/DURABLE_EVIDENCE.md` |
| Explicit helper models, shared model budgets and purpose usage | `docs/MODEL_TASKS_AND_HELPERS.md` |
| Tool outcomes, cancellation, and connector deadlines/retries | `docs/TOOL_OUTCOMES_AND_CANCELLATION.md` |
| Long-term memory | `docs/MEMORY_GUIDE.md` |
| Memory API / security / predicates / ingestion | `docs/MEMORY_API.md`, `docs/MEMORY_PERMISSIONS.md`, `docs/MEMORY_PREDICATES.md`, `docs/MEMORY_SIGNALS.md` |
| Release migration | `CHANGELOG.md` and the upgrade section in `USER_GUIDE.md` |
| Runnable examples | `examples/README.md` and `examples/*.ts` |
| Pre-built agent runtime usage | `USER_GUIDE.md#agent-runtime-preview` and `examples/agent-runtime-local.ts` |
| Agent runtime architecture and server roadmap | `docs/designs/AGENT_RUNTIME.md` |
| Server/desktop Agent packages, remote tools, and WebRTC ownership | `docs/designs/DISTRIBUTED_AGENT_EXECUTION.md` |
| Staged agentic architecture evolution, evaluation, and compatibility requirements | `docs/designs/AGENTIC_ARCHITECTURE_EVOLUTION.md` |
| Stage 16A approved API and delivery record | `docs/designs/STAGE_16A_NATIVE_COMPACTION_API.md` |
| Version 2 adoption, stage availability, and standard-documentation handoff | `docs/VERSION_2_GUIDE.md` |
| Stage 00 offline/live evaluation, completion gates, compatibility fixtures, and measured pilot | `docs/AGENTIC_BASELINE_EVALUATION.md` |

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

## Staged architecture development

Persistent scope instruction (2026-10-22): the user selected **Stage 16A only**
and approved revision 2 of its API by saying “proceed with implementation” after
the compatibility-first presentation. Read
[the API proposal](docs/designs/STAGE_16A_NATIVE_COMPACTION_API.md) and the updated
roadmap first. Its `ContextCompactionStrategy` and `compactContext()` signatures
are implemented and validated on branch; read [the native recipe](docs/NATIVE_CONTEXT_COMPACTION.md) for current usage and support. Preserve existing strategy APIs/defaults and use
the existing `compactionStrategy` instance extension point for optional plugin/history
composition. No replacement configuration or mandatory migration is authorized.
Stage 16B retention research remains deferred and unauthorized.
The recorded approval covers 16A only and does not waive the separate breaking-change approval rule.

Persistent user instructions (2026-10-07): develop the agentic architecture in
stages, with extensive test coverage and good examples for every stage. Update
AMOS to illustrate relevant new capabilities. The detailed roadmap and stage
records live in
[Agentic Architecture Evolution](docs/designs/AGENTIC_ARCHITECTURE_EVOLUTION.md).
Maintain the outward-facing [Version 2 Guide](docs/VERSION_2_GUIDE.md) as stages
progress, and use its handoff ledger to update the README, User Guide, API reference,
examples, AMOS documentation, and release notes without losing delivered details.
These instructions govern changes to OneRingAI itself, not ordinary applications
using OneRingAI as a dependency.

- Implement the requested stage and complete its validation before proceeding.
  Do not treat the roadmap as authorization to implement all stages. If the user
  explicitly authorizes multiple stages, follow that scope.
- Follow the roadmap's dependency-valid core delivery sequence. Conditional work
  is not a prerequisite for core stages; record the smallest requested scope and
  deferred extensions. Reuse current facilities before adding new abstractions.
- Include meaningful regression, failure, lifecycle, and compatibility tests,
  plus mock integration coverage when a stage crosses subsystem boundaries.
  Cover cancellation, persistence, concurrency, budgets, and authorization where
  relevant; do not substitute shallow implementation-mirroring tests for coverage.
- Ship runnable examples with documented setup, expected behavior, and cleanup.
  Prefer deterministic offline demonstrations plus explicitly opt-in live modes.
  Update `examples/README.md` and relevant public documentation.
- Update AMOS when users can use or inspect the new capability. Test the app's
  adapter/configuration/commands as appropriate. Otherwise record why an AMOS
  change is not applicable in the stage completion record.
- Keep the stage table and execution records current with actual validation
  results, compatibility evidence, examples, limitations, and the next stage.
- Before marking each stage complete, update the Version 2 Guide's availability,
  adoption record, and documentation handoff. Record verified public APIs/options,
  defaults, support boundaries, examples, usage, persistence, failure behavior,
  compatibility, and limitations; explicitly record internal-only changes. Separate
  branch availability from a verified package release. Update affected existing
  usage docs in the delivering stage, and regenerate generated API documentation
  rather than hand-editing it. Pending release-wide edits remain tracked in the ledger.

**Backward compatibility is required wherever possible.** Prefer additive APIs,
optional configuration, legacy adapters, and opt-in behavior. Preserve supported
public signatures, defaults, extension contracts, return/event shapes, and saved
configuration/session loading. Assess behavioral as well as TypeScript compatibility.

**If proposing a breaking API change, stop the affected work, explain the logic,
the specific proposed change, affected consumers, alternatives, and migration,
and obtain the user's explicit approval before implementing it.** Do not treat a
new branch, major-version label, stage authorization, or this roadmap as approval
for a break. Record the specific approval and its scope in the stage record.

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

For stages that affect agent/context/tool contracts, preserve the Stage 00
baselines described in [the evaluation guide](docs/AGENTIC_BASELINE_EVALUATION.md).
After building, `npm run test:agentic:compat` checks a consumer against the built
public package. `npm run example:agentic-baseline` runs offline; the separately
opt-in `npm run test:agentic:live` makes real billable LLM calls. Record unavailable
providers explicitly rather than silently treating skipped tests as validation.

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

## Experimental context strategies

`ObservationMaskingStrategy` and `StructuredSummaryStrategy` are opt-in; algorithmic
remains the default. Both require the enabled built-in evidence plugin and retain
acknowledged scoped source snapshots before replacing older read bodies. Exact user
messages, action arguments/metadata, write/unknown effects, pending dependencies
and opaque/multimodal state remain protected. Summaries are assistant data with
locally validated bounded sections/references; they do not acquire host authority
or prove semantic truth. Managed summaries share the configured compactor and
active ModelTask, including repair/cancellation limits. Read
[Context Strategies](docs/CONTEXT_STRATEGIES.md) before selecting a policy; inspect
`lastPreparation.compaction` with actual task usage. The bounded live comparison
is a functional pilot, not a general quality/cost claim. Preserve existing explicit
rollover and custom strategy contracts.


## Protected host task state

Enable `context.features.taskState` explicitly with `plugins.taskState` containing
a host-selected scope/taskId and optional immutable association/lifecycle binding.
Use `TaskStatePluginNextGen.updateHost(delta, revision)` for confirmed notes;
`propose`/`assume` keep model interpretations unconfirmed. No mutation/store tools
are exposed. `recordAction(actualOutcome, revision)` is explicit; enabling the
plugin does not observe every tool automatically. A succeeded/settled submission
does not prove remote completion; `confirmAction` records a separate host check.
Capacity/revision errors never justify replaying an external action.

The bounded full view is noncompactable and protected at final managed dispatch,
including JSON repair; direct calls bypass managed task state. Optional version-1
snapshots preflight task/scope/association; legacy snapshots clear enabled notes.
Task/routine statuses are cached authority views; linked memory tasks are read via
`refreshMemoryTask` under host scope and transitioned through MemorySystem itself.
Automatic extraction, duplicate-effect prevention and a new workflow engine are
outside this stage. Read [Task State](docs/TASK_STATE.md) for limits, trusted
checkpoint assumptions, pruning, exact APIs, examples and AMOS host commands.


Task-state capacity recovery is explicit and atomic: `updateHost` accepts optional
`confirmActions` (executionId/status/source) and `prune` (noteIds/executionIds), applied
after notes/resolutions and admitted against the final fitting snapshot. Inputs
remain bounded and only host-confirmed terminal actions/resolved or superseded
notes can be pruned. Archive proof first where needed; never repeat a write to
repair state. Reusing a pruned ID detaches obsolete correction/conflict links while
keeping historical predecessors inactive. Final managed task guards also run after
budget observers. AMOS exposes explicit `task prune`, `resolve-prune`, `prune-action`
and `confirm-prune` host commands; see the task-state recipe for arguments.

## Bounded managed-loop policies

`loopPolicy` is opt-in on managed run/stream; a per-call `null` disables it.
Recovery limits share one allowance and existing iteration/ModelTask bounds.
Declare read effects accurately. Repeated admitted writes/unknown effects stop
before replay, and uncertain completion requires host inspection. Application
`success:false` data is not a framework failure. A host `completion` callback
must verify actual scoped state/evidence; its success appears in optional `loop`
diagnostics, separately from model/provider completion. No checker means no
workflow completion assertion. Check packets are bounded/frozen, timed, cancelled
and stale-view checked. Callbacks/counters are not restored from sessions.

Configured streaming uses shared `before:tool` preparation; unconfigured hook
traces stay unchanged. Provisional chunks cannot be retracted; JSON repair stays
run-only. Direct, realtime and external SDK loops keep their existing owner.
See [Loop Policies](docs/AGENT_LOOP_POLICIES.md) before enabling a policy and inspect
`response.loop`, existing stream metadata or `agent.getLoopDiagnostics()`.
AMOS `/context loop` displays these notices separately from assistant prose.

Stage 10 review corrections preserve admitted async effects across re-registration
and import authentic queued observations before receiving policy dispatch/checks.
Legacy uncorrelated deliveries use receipt effect or unknown, never current tool
metadata; missing action outcomes block conservatively. Normal policy stops commit
settled input without duplicate journal entries; stopped-turn JSON formatting
appends its final answer while retaining exact calls/results. Class/prototype
callbacks keep the original host receiver; thresholds/callbacks are captured per
execution. These helpers/correlation are internal and not saved authority.


Helper `validationSchema` optionally adds local constraints to the portable native
`schema`; both must pass inside the existing repair allowance. Automatic structured
summaries use it to repair all-empty/blank/overlong content before apply. Do not add
an outer retry or replay source actions. Pending loop checks also bind tool
principal/account/identity/role/session and connector scope, rejecting stale verdicts.

## Minimal opt-in presets

`createAgentPreset('research' | 'workflow', config)` returns ordinary AgentConfig
without IO/model calls. Research defaults to observation masking/12 iterations;
workflow to algorithmic compaction + task state/8. Both enable scoped evidence
and existing bounded recovery. Require host userId + matching explicit evidence
scope/storage, and workflow taskId/scope. Explicit settings override defaults;
null loopPolicy disables recovery. Helpers, hard budgets, permissions and host
completion predicates remain explicit. Disabled evidence requires a compatible
strategy. Use `agent.inspectCapabilities()` for actual managed settings/provider
support, `RuntimeAgent.inspect()` for drivers; neither proves semantic completion.
Preset names are not authority in portable/session metadata. Foreign scoped state
must reject restoration, never silently rebind. AMOS `/preset` selects the next
agent, with active/saved inspection and unchanged live history. Read
[Agent presets](docs/AGENT_PRESETS.md) before composing or transferring policy.

Preset corrections: undefined context identity cannot erase the validated host
principal. Enabled protections require matching built-in plugin instances at
creation/dispatch; compatible factories are allowed and ordinary custom plugin
contracts remain unchanged. Opaque/accessor plugin configurations keep receivers.
Inspection projects declared getter-backed capability fields and omits provider
extras. Failed resume destroys the candidate and preserves the load error; AMOS
commits replacement after successful loading/checkpointing and keeps descriptive
metadata through autosave. See the preset recipe for support boundaries.

Stage 12 second corrections (2026-10-16) preserve caller-owned permission/prompt/
callback/role bindings on rejected resume, commit high-level load targets only after
validated restoration, serialize checkpoints with autosave and normalize getter
scopes. Teardown attempts all reachable owned resources despite plugin errors.
`context.save` additively accepts a deferred snapshot builder; `loadRaw` retains its
advanced unvalidated ID-selection behavior. Custom rollback failure blocks saving
until actual restoration of every damaged plugin or context rebuild. Restore hooks must not await checkpoint IO on their own
context; loads require idle host execution/edits. See the
[restoration recipe](docs/AGENT_PRESETS.md#session-restoration-and-cleanup) and
[latest completion](docs/designs/STAGE_12_SECOND_REVIEW_AND_FIX_PLAN.md#second-corrective-completion--2026-10-16).


Stage 12 third corrections (2026-10-16) include construction and synchronous loaded
notification in shared-resume rollback. Restore original policy/tools/roles/prompt/
compaction callback/history/session ID before candidate cleanup; partial candidates
release initialized framework resources while retaining the original error. Ordinary
managed notification failure also rolls back state/ID. Snapshots use JSON semantics,
including `toJSON`/Date, without a structured-clone requirement. Failed rollback
keeps saves blocked until every damaged plugin instance actually restores via a
valid checkpoint or trusted host `context.restoreState`; missing legacy keys or
ignored restore hooks do not repair it. Individual plugin methods are not tracked
as context recovery; rebuild if unrecoverable. Internal admission/binding/capture/
identity tracking adds no portable authority or required API/session/storage fields.
Preserve existing JSON serialization and event/exception contracts; narrowing them
requires explicit approval. Read the [latest completion](docs/designs/STAGE_12_THIRD_REVIEW_AND_FIX_PLAN.md#third-corrective-completion--2026-10-16)
and [restoration recipe](docs/AGENT_PRESETS.md#session-restoration-and-cleanup).


## Selective context assembly

Stage 05 and all review corrections are complete on branch (2026-10-22). See the
[latest completion](docs/designs/STAGE_05_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-22)
and [validation](docs/evaluations/STAGE_05_SECOND_CORRECTIONS_VALIDATION.json):
8,340 units, 190 live tests / 202 scenarios, 28 examples and 92 public controls pass.
Selected structured runs format before consolidation; selected structured suspension
formats before session/correlation persistence, with host freshness guards intact.
On formatting/storage failure, checkpoint the retained accepted observation before
destruction; never replay its action. Uncertainty includes native image/file result
arrays and tool signatures; AMOS shows a source-free notice. No release.

Effective accountId/connectorAccounts/taskId and registry-instance scope join existing
identity guards. Managed submitted-input edits get one bounded refresh in the same
contributor allowance; hooks/compaction are not replayed and source history is not
implicitly rewritten. Repair permits answer commits while checking the current host
prompt and earlier input. Selected-store guidance reflects partial visibility;
frozen/class schemas keep their native objects/getter receivers. Wrap-ups observe
last-request usage and consolidation fetches no contributors. Custom in-place scope
changes must still advance source revisions; internal tokens/frames add no authority.

Stage 05 uses optional `context.assembly` and explicit
`registerContextContributor(pluginName, contributor)`, not structural method detection.
Existing plugin interfaces/layout/observation hooks stay unchanged. Use
`createInContextMemoryContributor` for whiteboard selection without source deletion;
critical entries are protected. New blocks are JSON user data, never instructions or
authorization. Protected task/evidence/instruction plugins cannot be replaced.

Contributors are trusted host code. Maintain getRevision for all source/scope/task
changes, observe signal, and attach only to enabled authorized plugins. Component/
source budgets, full dependency closures, expiry, deadlines and final revision/input/
scope guards fail closed. Reattach callbacks after session load; sessions never
restore policy authority. JSON repair keeps the frozen selected prefix without
another compaction, preserving main diagnostics. Context.responseReserve and optional
reasoningReserveTokens provide explicit headroom without enabling thinking.

`lastPreparation.selection` reports metadata only, local estimates and actual provider
usage/cache counters with null for unknown. Stable-prefix layout and tool sorting are
opt-in; no provider-cache hit/key or model quality/cost improvement is implied. AMOS
contextAssembly/selectWhiteboard and breakdown show the distinction. Read
[Context Assembly](docs/CONTEXT_ASSEMBLY.md) before configuring contributors, native/
opaque state or persistence. Internal formatting-prefix/snapshot bookkeeping is not
a new public storage/workflow authority.

## Optional plugin/native history composition (Stage 16A)

Use public `ContextCompactionStrategy` through the existing `context.compactionStrategy`
instance field with explicit `plugins: 'auto' | 'off'` and `history: 'native' | 'off'`
(or `{ mode: 'native', preserveRecentTurns }`). Do not invent a registry name or a
new top-level context config. `plugins: 'off'` preserves enabled plugin features/tools.
`agent.compactContext({ target: 'all' | 'plugins' | 'history' })` owns the execution
slot; `automatic: false` keeps explicit scheduling. Native requires built-in scoped
evidence and a verified main-provider adapter; it does not use the helper compactor.
Use the complete provider window, provider counts and shared ModelTask accounting.
Never infer native token cost from ciphertext length, discard signed fields, or
recover by replaying actions. Native snapshots bind model/connector/endpoint and
host/evidence scope; incompatible switches require trusted checkpoint/fresh-context
recovery. Read [Native Context Compaction](docs/NATIVE_CONTEXT_COMPACTION.md) for
models, protected tails, usage, limits, examples and AMOS commands. No breaking
change or Stage 16B implementation was authorized.

Stage 16A review corrections keep transport identity at provider construction,
share OpenAI generation/count normalization, and reject known hosted/server-owned
controls before reduction/archival/billing. Unknown raw input controls fail on the
opted-in native path; legacy/direct escapes retain their supported behavior.
Composition reuses its initial frame, rebuilds after mutations and carries one
assembly cancellation signal/allowance throughout. Plugin-only mode must ignore
an old native driver. Use a new Agent for changed endpoint/account selection;
do not relabel an existing SDK by rebinding. See the
[review/correction record](docs/designs/STAGE_16A_REVIEW_AND_FIX_PLAN.md).

At the pre-compaction hook boundary, a plugin memory write or companion revision
change gets one bounded frame refresh under the existing contribution allowance.
Preserve documented `beforeCompaction` facts without weakening source/authority
guards or rerunning hooks. Read-only native evidence proofs honor cancellation and
ModelTask deadlines; late reads cannot dispatch/commit. Admitted writes and mutating
plugins still hold ownership until settled. Anthropic native admission rejects
top-level Responses reasoning before I/O instead of silently dropping it; retain
OpenAI reasoning and supported Anthropic signed thinking. See the
[second review/correction record](docs/designs/STAGE_16A_SECOND_REVIEW_AND_FIX_PLAN.md)
and `npm run example:native-hooks`.


Stage 16A third corrections validate provider-specific nested thinking replay before
counting/reduction/archive, preserving ordinary converters. Explicit compaction uses
the existing preservation lifecycle once, including `automatic: false`, with bounded
refresh/events and protected scope checks before hook execution. Anthropic fixed
thinking gets matching native wire/source/reservation headroom (budget + 4096 by
default, bounded by model output capacity); explicit host caps are respected and
known conflicts reject before archival. Main settings remain unchanged. Native
streaming is internal and cancellation closes it; unusable summaries retain billed
iteration usage. Use `npm run example:native-hooks-manual` for the explicit path,
with `-- --live=anthropic` to exercise an 8192-token fixed budget.
