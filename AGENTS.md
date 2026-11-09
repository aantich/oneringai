# OneRingAI Agent Guide

This is the canonical API and development guide for Codex, Claude Code, other
coding agents, and humans using or modifying `oneringai`. Claude's
[entry point](CLAUDE.md) imports this file; keep API guidance here rather than
maintaining a second copy.

## Persistent repository instructions

Persistent user instruction (2026-11-08): develop OneRingAI v2 directly on `main`.
Do not create new branches or switch to another branch unless the user explicitly
instructs you to do so. Preserve existing work. Merging, deleting, committing, and
pushing require their own applicable authorization; this rule grants none.

Persistent user instruction (2026-11-09): every v2 npm publication, including
prereleases, must include the corresponding update and deployment of
`oneringai.io` from `/Users/aantich/dev/oneringaidotio`. Refresh the pinned
documentation snapshot and generated HTML, and review/update the homepage,
quickstart, application pages, installation/version text, release links and
feature/support claims for that exact published version. Documentation sync
alone does not complete the website update. Follow [Releasing](RELEASING.md),
run the website checks and desktop/mobile QA, deploy through its existing GitHub
Pages workflow, and verify the public pages. Record the npm version, library
snapshot, website commit and successful deployment in the release handoff.
Do not call a v2 release handoff complete while the matching website is stale.
This standing requirement does not itself authorize another npm publication.

The current API baseline is **`oneringai@2.0.0-beta.3`**. v2 uses the unscoped
package `oneringai`; `@everworker/oneringai` belongs to the legacy v1 line.
Read [package migration](docs/PACKAGE_MIGRATION.md) before upgrading a consumer.
Historical plans, local agent memories, old branch names and dated test counts
are not current API or release instructions. Verify against the checked-out or
installed package, its public exports, and the current usage recipes below.
Implementation availability, npm publication, and live-provider verification
are separate claims; see the [Version 2 Guide](docs/VERSION_2_GUIDE.md) and
[beta.3 release evidence](docs/evaluations/BETA3_RELEASE_VALIDATION_2026_11_09.json).

## Fast facts and operating mode

- Language: strict TypeScript; Node.js 22.13+ or 24+; ESM and CJS outputs.
- Agents also run in modern secure browser pages and dedicated Workers since
  beta.2, with the **same Agent API and root imports**. The agentic loop and
  context plugins share their implementation across environments.
- Public imports use `oneringai` unless a documented subpath is required.
- Architecture: named connectors, context plugins, one shared ToolManager.

When using the package as a dependency:

- Read its installed `README.md`, `AGENTS.md`, `USER_GUIDE.md`, and
  `API_REFERENCE.md` under `node_modules/oneringai/` when available.
- Import public exports only. Do not import `src/**`, `dist/**`, or undocumented
  implementation paths. Use runnable examples instead of inventing method names.
- Check the installed version before adopting a newer recipe. Updating this
  library does not authorize upgrades or edits in another application.

When modifying this repository:

- Inspect the branch and working tree first; preserve existing changes.
- Relative TypeScript imports include `.js`. Use `export type` for types and
  `export` for runtime values. Use `src/domain/errors/AIErrors.ts` where applicable.
- Regenerate registries and API documentation; do not hand-edit generated files.
- Keep changes focused, update affected usage docs/examples, and run the relevant
  checks in [Repository validation](#repository-validation).

## Architecture invariants

```text
Application -> named Connector -> Agent -> provider
                                  |
                                  +-> AgentContextNextGen plugins
                                  +-> one shared ToolManager
```

1. `Connector` is the source of truth for authentication; named connectors allow
   multiple credentials/accounts to coexist.
2. AI connectors declare an explicit `Vendor`. Do not infer vendor from model names.
   External-service connectors use `serviceType`.
3. `agent.tools === agent.context.tools`. Register tools on this manager; do not
   build a parallel tool pipeline or replace it after construction.
4. Context capabilities are plugins. Disabled features add no prompt content or tools.
5. Feature flags are extensible; built-in flags are not a closed plugin list.
6. Use model/capability registries and endpoint-specific metadata. Unknown support
   stays unknown; a registry entry does not establish live account entitlement.
7. Host code owns authorization, tenant/user/account scope, completion checks and
   storage policy. Model arguments and saved sessions do not grant that authority.

## Minimal working agent

This Node example obtains credentials from the host environment. Browser hosts
supply credentials or an authenticated model gateway explicitly.

```typescript
// Documentation check: complete example
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

Switching providers changes the named connector and model. Tools, plugin authoring
and task logic retain the same APIs; provider capabilities still need checking.

## Browser and Worker setup

Read [Browser Agents](docs/BROWSER_AGENTS.md) and the
[shared application example](examples/browser-node/shared.ts) before browser work.
There is no `BrowserAgent`, runtime switch, or bootstrap call. Browser-aware
bundlers select conditional exports for `oneringai`, `oneringai/agents`,
`oneringai/shared` and `oneringai/types`. Use browser declarations explicitly:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "customConditions": ["browser"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": [],
    "skipLibCheck": false
  }
}
```

- Workers use `ES2022`/`WebWorker` libraries. Create connectors, plugins and agents
  inside that realm; bridge UI actions through explicit application messages.
- Browser tools can call APIs or use capabilities allowed by their host. CORS,
  provider credential support and browser permissions still apply. Keep privileged
  credentials in a trusted host; browser code can read credentials supplied to it.
- The browser catalog includes compatible JSON/routine tools and generic API plus
  GitHub/Slack connector factories. Node retains its full tool catalog. Filesystem,
  shell/desktop tools, document parsers (including `web_fetch`), file storage/logging,
  OAuth/JWT credential acquisition, Vertex ADC, media generation, realtime Agent
  sessions and `oneringai/agent-runtime` harness implementations remain host-only.
- Browser MemorySystem/InMemoryAdapter work with compatible supplied dependencies;
  Mongo and connector-backed memory construction remain Node integrations.
- Supply existing storage interfaces or `StorageRegistry` factories for durable
  sessions and features with disk defaults. Working memory and enabled evidence
  default to memory; no IndexedDB backend or automatic durability is supplied.
- No Node globals or application source aliases are required. Use HTTPS/localhost
  for Web Crypto. Dynamic helper/collection schemas work under strict CSP.
- Inference remains at the provider. Large histories require local preparation,
  serialization and memory; a million-token model window is not a universal browser
  performance guarantee. A Worker can keep preparation away from the page UI.
- ModelTask budgets are explicit and realm-local; use host enforcement for spending
  boundaries. Save checkpoints and destroy agents during teardown.

## Choose the right surface

| Goal | Preferred API / recipe |
| --- | --- |
| Stateful, tool-using assistant | `Agent.create()` + `agent.run()` |
| Typed token/event streaming | `agent.stream()` |
| Direct model call without managed context | `agent.runDirect()` / `streamDirect()` |
| Structured JSON | `responseFormat`; read `output_parsed` |
| Authenticated external service | Named `Connector`, `ConnectorTools.for()` or `Connector.get(name).fetch()` |
| Explicit operational failure with unchanged raw result | `createOutcomeTool()`; [outcomes](docs/OUTCOME_AWARE_TOOLS.md) |
| Large dynamic tool sets | `context.features.toolCatalog`; [tool catalog](docs/CONNECTOR_TOOL_CATALOG.md) |
| Custom context data | `BasePluginNextGen` + explicit `ContextContributor` registration |
| Host-confirmed task view | `context.features.taskState`; [task state](docs/TASK_STATE.md) |
| Bounded recovery and host completion checks | `loopPolicy`; [loop policies](docs/AGENT_LOOP_POLICIES.md) |
| Verified routine execution | `createRoutineRunner({ verify })`; [routines](docs/VERIFIED_ROUTINES.md) |
| Multiple cooperating Agents | `await createOrchestrator()` / `createOrchestratorWithFactory()` |
| Interchangeable OneRingAI/Codex/Claude harnesses | `oneringai/agent-runtime`; [runtime bindings](#agent-runtime-and-harness-bindings) |
| Scoped recoverable tool results | Evidence plugin; [durable evidence](docs/DURABLE_EVIDENCE.md) |
| Helper models and aggregate model budgets | `modelExecution.helpers`, `ModelTask`; [helpers](docs/MODEL_TASKS_AND_HELPERS.md) |
| Host-selected model routes | `modelExecution.routing`; [routing](docs/MODEL_ROUTING.md) |
| Opt-in research/workflow defaults | `createAgentPreset()`; [presets](docs/AGENT_PRESETS.md) |
| Long-term entity/fact knowledge | `MemorySystem`; [memory](docs/MEMORY_GUIDE.md) |
| External MCP servers in Node | `MCPRegistry`; [MCP integration](MCP_INTEGRATION.md) |

## Agent execution and completion

- `run(input, options?)` uses context, tools, plugins and bounded preparation.
  `stream(input, options?)` emits typed events; drain or close the iterator properly.
- `runDirect()` / `streamDirect()` bypass managed context. Tools are excluded unless
  `includeTools` is enabled. Direct calls do not acquire managed task/loop protections.
- `thinking`, `temperature`, `vendorOptions`, `responseFormat` and `modelTask` are
  per-call options. Managed cancellation uses `agent.cancel()`; do not invent a
  `RunOptions.signal`. Direct/helper/composition APIs expose their own signal options.
- When supplying a context configuration object, include its required `model`
  field as well as the Agent's model. Omitting the entire context option uses the
  Agent's default context construction.
- Native Agent responses use `output_text` and optional `output_parsed`. Runtime
  harness results use `outputText`; these are different public result contracts.
- Use `run()` when prompt-fallback structured output must combine with tools: its
  final tool-free repair is bounded. Streaming does not gain that repair pass.
- `loopPolicy` is opt-in; a per-call `null` disables it. A host `completion` callback
  verifies actual scoped state/evidence. Model/provider completion alone is not
  business completion. Inspect `response.loop` or `agent.getLoopDiagnostics()`.
- Recovery allowances share existing iteration/task bounds. Declare read/write
  effects accurately. Repeated writes/unknown effects stop before unsafe replay;
  cancellation never proves whether an external action happened.
- `createAgentPreset('research' | 'workflow', config)` returns ordinary AgentConfig
  without I/O. It requires explicit matching host scope/storage; workflow also
  requires task state. Permissions, helpers, hard budgets and completion stay explicit.

```typescript
const response = await agent.run('Return the two highest priorities.', {
  responseFormat: {
    type: 'json_schema', name: 'priorities', strict: true,
    schema: {
      type: 'object',
      properties: { items: { type: 'array', items: { type: 'string' } } },
      required: ['items'], additionalProperties: false,
    },
  },
});
```

## Connectors and tools

Pass connector names, not service-type names, to agents and tool factories.
AI connectors use `vendor`; service connectors use `serviceType` and endpoint/auth
configuration. The service templates configure defaults; selected services add
specialized tools. See [the complete catalog](docs/CONNECTOR_TOOL_CATALOG.md).

```typescript
import { Connector, ConnectorTools, Services } from 'oneringai';

Connector.create({
  name: 'serper-research', serviceType: Services.Serper,
  auth: { type: 'api_key', apiKey: process.env.SERPER_API_KEY! },
  baseURL: 'https://google.serper.dev',
});
// Include this selection in Agent.create({ connector, model, ... }).
const researchConfig = {
  identities: [{ connector: 'serper-research' }],
  tools: ConnectorTools.for('serper-research'),
};
```

- Tools come from application functions, generated built-ins, context plugins,
  connectors, and MCP. Tool names must be unique; return serializable data and
  add `describeCall` for human-readable UI activity.
- Search/scrape tools come from configured service connectors or `SearchProvider` /
  `ScrapeProvider`. Never put credentials in prompts, tool arguments or source.
- `identities` restricts which connector categories an Agent may discover; it does
  not replace host approval.
  Use `PermissionPolicyManager` and user rules for sensitive/destructive tools.
- `agent.tools.execute()` preserves raw returns; `executeWithOutcome()` exposes
  diagnostics. Application `success: false`/`error` fields are not framework failures.
  Use `createOutcomeTool()` to report an invocation-owned operational failure.
- Forward `ToolContext.signal` to requests. Admission captures connector/permission
  ownership; later re-registration must not rebind an admitted action.
- Late outcomes retain original call/run IDs and remain diagnostic. Inspect outcome
  and evidence separately; storage/projection failure never authorizes action replay.
  Read [outcomes and cancellation](docs/TOOL_OUTCOMES_AND_CANCELLATION.md).

Minimal custom tool (compatible with both Agent environments):

```typescript
// Documentation check: complete example
import type { ToolFunction } from 'oneringai';

const getWeather: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'get_weather', description: 'Get current weather for a city.',
      parameters: {
        type: 'object', properties: { city: { type: 'string' } },
        required: ['city'], additionalProperties: false,
      },
    },
  },
  execute: async ({ city }) => ({ city, temperatureC: 21 }),
  describeCall: ({ city }) => `Weather for ${String(city)}`,
};
```

### Selected connector and remote extensions

- `ConnectorTools.enhanced(name, { profile: 'execution-v1' })` explicitly selects
  enhanced execution. Use exact static identity/source/account registration and
  host approvals from [Enhanced Connectors](docs/ENHANCED_CONNECTORS.md). Existing
  factories/defaults remain unchanged.
- `collections-v1` additionally requires the manager-local catalog gate and actual
  selected identity filters before run/session loading. Returned count, provider
  pagination end and corpus coverage are independent. Cursor keys survive catalog,
  rollover and scopes, but not new managers/processes/clear. Evidence is separately
  opt-in. Follow [whole collection pages](docs/CONNECTOR_COLLECTION_PAGES.md) and
  the [capacity inventory](docs/CONSUMER_CAPACITY_INVENTORY.md); do not raise unrelated limits.
- Remote outcome parity uses the separate negotiated C7 APIs, including
  `AgentPackageOutcomeServer`, `createAgentPackageOutcomeTools()` and
  `hydrateAgentPackageWithOutcomes()`. Protocol v2 remains unchanged. Scope evidence
  and authorize all transport operations; reconcile uncertain writes using original
  source receipts. Reuse the same evidence storage handle and shared ToolManager.
  See [Remote Tool Outcomes](docs/REMOTE_TOOL_OUTCOMES.md).

## Context plugins: built-in and custom

Feature flags are open string keys. External developers do not need core changes
to add plugins. `PluginRegistry` registers factories for automatic initialization;
`agent.context.registerPlugin(instance)` supports manual initialization. Select one
path per plugin instance/name, then explicitly register its data contributor.

| Built-in feature | Default | Purpose |
| --- | --- | --- |
| `workingMemory` | `true` | Tiered scratch storage outside the full prompt |
| `inContextMemory` | `true` | Small high-value state in context |
| `persistentInstructions` | `false` | Deprecated keyed instruction store |
| `userInfo` | `false` | Deprecated user store/TODO tools |
| `toolCatalog` | `false` | Discover/load/unload tool categories |
| `sharedWorkspace` | `false` | Versioned multi-agent coordination |
| `memory` | `false` | Long-term memory injection plus six read tools |
| `memoryWrite` | `false` | Six write tools; requires `memory` |
| `evidence` | disabled | Scoped evidence and opt-in result projections |
| `taskState` | `false` | Host-controlled task view and revision-checked notes/receipts |

For new data plugins, extend `BasePluginNextGen` and implement `ContextContributor`
on the same class. Keep trusted usage guidance in `getInstructions()`, return
`null` from required `getContent()`, expose host inspection via `getContents()`,
and return data blocks from `contribute()`. Advance `getRevision()` for source,
scope, permission and selection-policy changes; invalidate the base token cache
when state changes. This is not a request for TTL caches or cross-plugin plumbing.

Given your `AppContextPlugin` implementation, manual registration is:

```typescript
const plugin = new AppContextPlugin();
agent.context.registerPlugin(plugin);
agent.context.registerContextContributor(plugin.name, plugin);
```

Alternatively, register a factory **before** creating the Agent. This checkout
uses the exported class from the shared example below; in your application,
import your own plugin implementation. The host first configures `app-model`.

```typescript
// Documentation check: complete example
import { Agent, PluginRegistry } from 'oneringai';
import { AppContextPlugin } from './examples/browser-node/shared.js';

export function createAppAgent(model: string) {
  if (!PluginRegistry.has('appContext')) {
    PluginRegistry.register('app_context', config =>
      new AppContextPlugin('app_context', String(config?.currency ?? 'EUR')),
      { featureKey: 'appContext' });
  }
  const agent = Agent.create({
    connector: 'app-model', model,
    context: {
      model,
      features: { workingMemory: true, inContextMemory: true, appContext: true },
      plugins: { appContext: { currency: 'EUR' } },
    },
  });
  const plugin = agent.context.getPlugin<AppContextPlugin>('app_context')!;
  agent.context.registerContextContributor(plugin.name, plugin);
  return agent;
}
```

The feature/config key is `appContext`; the instance name is `app_context`.
`PluginRegistry.has()` takes the feature key. Register once per realm; dependencies
must be enabled. A contributor is not discovered by structural method detection.
The [complete authoring walkthrough](USER_GUIDE.md#creating-context-plugins),
[offline custom plugin](examples/custom-context-plugin.ts) and
[shared browser/Node example](examples/browser-node/shared.ts) include implementations,
updates, tools, revisions, state validation and cleanup.

### Prompt authority and selective data

Legacy `getInstructions()` **and `getContent()` enter canonical developer
instructions**. Do not put retrieved or lower-authority data in either field.
An explicitly registered contributor replaces only that plugin's legacy content
view with JSON user-context data. Omit contributor `instructions` to inherit usage
text, supply trusted text to replace it, or `null` to suppress it; explicit
`undefined` also supplies no usage text. Unregistering restores the legacy view.
See [Plugin Prompt Authority](docs/PLUGIN_PROMPT_AUTHORITY.md).

Optional `context.assembly` controls data budgets, stable-prefix layout and headroom;
`createInContextMemoryContributor()` selects whiteboard entries without deleting
source state. Protected task/evidence/instruction sources cannot be replaced.
Observe contributor cancellation/deadlines, full dependency closures and revisions;
registration does not grant authorization. Inspect `lastPreparation.selection`
for metadata and local estimates, with provider usage/cache counters unknown when
unreported. Layout does not guarantee provider cache hits or cost/quality gains.
Read [Context Assembly](docs/CONTEXT_ASSEMBLY.md).

### Preparation, compaction and persistence

- Preparation runs one bounded compaction pass before dispatch, rebuilds the request,
  then checks sanitized capacity/scope/replay constraints. Do not pre-compact the
  same managed turn in application code; inspect `lastPreparation` instead.
- Tool-call/result dependency groups stay together. Pending/async results and
  unacknowledged evidence remain protected. Spill writes complete before removal;
  failures preserve history. Retrieve notes with exact index keys (including suffixes):
  the index and keyless `store_get({ store: "notes" })` contain metadata only.
  `store_list` discovers omitted entries. See [preparation](docs/CONTEXT_PREPARATION.md).
- Algorithmic compaction remains the default. `ObservationMaskingStrategy` and
  `StructuredSummaryStrategy` are opt-in and require built-in scoped evidence.
  Preserve writes/unknown effects, exact protected history and recoverable sources;
  model summaries are data, not authority. See [strategies](docs/CONTEXT_STRATEGIES.md).
- Native composition uses `new ContextCompactionStrategy(...)` in the existing
  `context.compactionStrategy` instance field, with `plugins: 'auto' | 'off'` and
  `history: 'native' | 'off'` (or the documented history object). Do not invent
  another registry name or top-level config. `agent.compactContext({ target })`
  supports `all`, `plugins`, `history`; `automatic: false` permits manual scheduling.
  Native history requires scoped built-in evidence and a verified main-provider
  adapter; it does not use the helper compactor. Preserve exact provider/endpoint/
  account ownership and signed/opaque state. See [native compaction](docs/NATIVE_CONTEXT_COMPACTION.md).
- Save/load with `agent.context.save()` / `load()`. Recreate/register plugins and
  contributors **before loading** checkpoints. They restore data, not executable
  factories, callbacks, credentials, policies or ModelTask authority. Manual plugin
  registration after `Agent.resume()` cannot recover state already skipped at load.
- Loads require idle host execution/edits. Rejected restoration preserves original
  state/configuration; rollback failure blocks saving until actual repair or rebuild.
  Preserve JSON serialization contracts. See [restoration](docs/AGENT_PRESETS.md#session-restoration-and-cleanup).

## Evidence, task state and verified routines

- Enable `context.features.evidence` explicitly. Default evidence is process-local
  memory; use a stable host scope and acknowledged backend for restart recovery
  (`FileEvidenceStorage` in Node, or a supplied backend).
- Raw returns/events stay raw; projections receive detached redacted data. Inspect
  `outcome.evidence` separately from execution. Failed storage/projection is not a
  failed external action. Preserve observations, repair storage, then use host-only
  `context.acknowledgeToolEvidence(callId, reference)` with result-bearing proof.
  `evidence_read` is bounded; `evidence_list` discovers omitted references.
- Interrupted results and queued async completions need checkpoint/recovery before
  teardown. A receipt without a result cannot release raw protection. Custom stores
  need realistic serialization/backend limits. See [durable evidence](docs/DURABLE_EVIDENCE.md)
  and [backend conformance](docs/EVIDENCE_CONFORMANCE.md).
- `features.taskState` requires `plugins.taskState` with host-selected task/scope.
  `TaskStatePluginNextGen.updateHost(delta, revision)` records confirmed notes;
  model proposals remain unconfirmed. `recordAction()` is explicit; settled
  submission does not prove remote completion. `confirmAction()` records that
  separate host check. Prune only eligible confirmed/resolved state after archiving
  proof as needed. No mutation tools or automatic duplicate-effect prevention are
  added. Read [Task State](docs/TASK_STATE.md).
- `createRoutineRunner({ verify })` is opt-in; legacy `executeRoutine` and
  `createRoutineTool` remain. Verify readiness and final post-step state with host
  evidence. Renewed authorization resumes opaque same-process single-use handles;
  durable workflow/cursor recovery is not implemented. Nested work shares its task,
  deadlines and ToolManager. Retain waiting children/unacknowledged evidence; never
  replay an action to repair bookkeeping. See [verified routines](docs/VERIFIED_ROUTINES.md).

## Helpers, budgets and managed model routing

- `modelExecution.helpers` configures named `compactor`, `extractor`, `verifier`
  connectors. `agent.invokeHelper(role, textOrBuilder, { schema, modelTask })` is
  stateless/tool-free, with documented defaults of 512 output tokens and one repair.
  Optional `validationSchema` adds independent local constraints within that same
  repair allowance. Both schemas must pass; no outer retry is required.
- Share an explicit host-owned `ModelTask` across main/direct/helper calls to share
  call/token/deadline/model token-cost reservations. A helper without that task owns
  an independent task. Missing/partial provider usage stays unknown; costs are
  registry estimates, not external fees. Read `task.snapshot()` / `getModelUsage()`.
- Helpers and routing are opt-in. Context transfer to other connectors/accounts
  requires `allowContextTransfer: true`; saved sessions never restore task authority.
  Read [Model Tasks and Helpers](docs/MODEL_TASKS_AND_HELPERS.md).
- `modelExecution.routing` defines named routes and bounded host selection;
  `RunOptions.routing` supplies hints/route or `null` opt-out. One managed execution
  keeps its selected owner/task through retries, repair, compaction and suspension.
  Public defaults stay unchanged. Inspect optional `routing` diagnostics; selection
  alone does not establish dispatch/completion.
- Provider-bound state retains its exact owner, including when routing is omitted.
  Reconcile/cancel outstanding async work before replacing ownership. Preserve the
  original route/task/options on rejected resume; failed finalization retains the
  accepted observation for checkpoint repair. Never replay writes on another route.
  Helpers/direct/explicit maintenance retain their own documented bindings.
  Read [Model Routing](docs/MODEL_ROUTING.md).

## Long-term memory

`MemorySystem` is an entity/fact knowledge system supporting provenance, graphs,
embeddings, ranked recall, entity resolution, bitemporal queries, profiles and
permissions. It is distinct from conversation history and context scratch storage.

- `features.memory` requires `plugins.memory.memory` with a MemorySystem instance
  and enables six read tools. `memoryWrite` adds six write tools and requires
  memory, host user identity and agent identity. Prefer read-only memory plus
  `SessionIngestorPluginNextGen` when the model should not mutate knowledge.
- Supply trusted owner/user/group/principal scope. The legacy visibility default
  is public-read; production multitenant apps should set `visibilityPolicy`
  explicitly. Never derive authorization from LLM-controlled tool arguments.
- Task transitions use `transitionTaskState` under host authorization; do not create
  parallel facts for workflow status/due dates. Use the documented iterator/page
  APIs when complete corpus traversal is required rather than treating capped prompt
  slices as exhaustive results.
- Node can use `createMemorySystemWithConnectors()` and Mongo integrations; browser
  hosts supply compatible dependencies. Run Mongo/vector migrations as documented.
- Follow [Memory Guide](docs/MEMORY_GUIDE.md), [API](docs/MEMORY_API.md),
  [permissions](docs/MEMORY_PERMISSIONS.md), [predicates](docs/MEMORY_PREDICATES.md)
  and [signals](docs/MEMORY_SIGNALS.md).

## Orchestration and MCP

`await createOrchestrator(config)` returns a regular Agent with SharedWorkspace
and five tools: `assign_turn`, `delegate_interactive`, `send_message`, `list_agents`,
`destroy_agent`. `assign_turn` is asynchronous; results arrive as follow-up messages.
There is no `assign_parallel` tool. Use interactive delegation only when the
specialist needs a user conversation. `autoDescribe: true` makes a model call at
creation; ordinary construction does not require generated descriptions.

`await createOrchestratorWithFactory(config, options)` supports complete plain
`OrchestratedAgentConfig` from required `configureAgent` before initialization.
Resolve parent/workers independently, preserve library-owned hierarchy/workspace/
tools, and pass ModelTask per operation. Borrowed resources are not destroyed;
retained work/evidence blocks unsafe reuse. Old constructors/callbacks remain.
Read [the factory recipe](docs/ORCHESTRATOR_FACTORY.md).

For MCP in Node, create/connect an `MCPRegistry` client, then
`client.registerTools(agent.tools)`. Keep it connected while tools can execute;
`await client.disconnect()` and registry removal/destruction belong to host teardown.
Follow [MCP integration](MCP_INTEGRATION.md). Do not import the Node MCP client into
browser builds; use host-provided compatible tools/transports instead.

## Agent runtime and harness bindings

This Node/host layer is separate from the portable `Agent` loop. Prefer reusable
`runtime.createAgent(definition)` with exact host-resolved tool names, followed by
`assistant.inspect(options)` and `assistant.openSession(options)`. Bind the
`execution: { driver, connector, model }` per session alongside trusted context,
environment and policy. The older `runtime.agent(spec)` API remains supported.

| Harness | Public import | Driver ID |
| --- | --- | --- |
| OneRingAI Agent | `OneRingAIDriver` from `oneringai/agent-runtime` | `oneringai.agent` |
| Local Codex SDK | `CodexSdkDriver` from `oneringai/agent-runtime/codex` | `openai.codex.sdk` |
| Local Claude SDK | `ClaudeAgentSdkDriver` from `oneringai/agent-runtime/claude` | `anthropic.agent.sdk` |
| Managed OpenAI | `OpenAIManagedDriver` from `oneringai/agent-runtime/openai-managed` | `openai.agents.api` |
| Managed Claude | `ClaudeManagedDriver` from `oneringai/agent-runtime/claude-managed` | `anthropic.managed.api` |

- `const run = await session.run(input, options)` yields a handle: observe
  `run.events()` and await `run.result`; inspect its status and `outputText`.
  Observation is not permission to replay an uncertain task/tool invocation.
- Register desired drivers at `LocalExecutionBackend` construction and use its
  host resolver/ToolManager policies. Local Claude's tools-only profile disables
  ambient/native filesystem/shell/web configuration. Do not bypass it through raw SDK options.
- Use `FileRuntimeSessionStorage` or `StorageRegistry.runtimeSessions` for durable
  control state. Persist `session.reference()` and resume through
  `runtime.resumeSession(reference, { context })` with trusted original scope.
  References are locators, never credentials or workflow/task authority.
- Uncertain input/tool effects require original source reconciliation. Managed
  OpenAI creation includes first input; never resend an uncertain creation. Native
  idle is not root-turn completion. Managed Claude waiting/budget states remain
  waiting, and runtime schema output is unsupported there.
- Native custom `configureAgent` requires `configurationRevision` for recovery
  compatibility. File control storage requires acknowledged POSIX single-host
  primitives; Windows needs a custom adapter.
- `session.uploadFile()` / `downloadArtifact()` require explicitly enabled backend
  `fileTransfer(context)` roots, MIME allowlists and byte bounds. Cleanup uses
  `await runtime.destroy()`; detach, cancel and delete have distinct semantics.
- Read [runtime recipes](USER_GUIDE.md#reusable-definitions-and-harness-bindings),
  [recovery](USER_GUIDE.md#runtime-recovery-and-control-storage),
  [file boundaries](USER_GUIDE.md#explicit-files-and-artifacts) and the
  [offline five-driver example](examples/agent-runtime-swappable.ts).
  Offline conformance does not establish native/provider live support.
- AMOS `--runtime-host` and additive `--runtime-resume` use the same APIs and trusted
  host scopes, and gate native context/routine/helper mutation commands. Follow
  [the cookbook](apps/amos/docs/AGENT_RUNTIME.md) and
  [host example](apps/amos/examples/runtime-host.ts). Standard AMOS stays a Node terminal app.

## Model metadata and specialized APIs

Use the library's high-level capabilities instead of bypassing connectors with
vendor SDK calls. Check the environment's actual public export surface first.

| Capability | API / registry |
| --- | --- |
| Images | `ImageGeneration`, `IMAGE_MODELS` |
| Video | `VideoGeneration`, `VIDEO_MODELS` |
| Text-to-speech / transcription | `TextToSpeech` / `SpeechToText`, `TTS_MODELS` / `STT_MODELS` |
| Embeddings | `Embeddings`, `EMBEDDING_MODELS` |
| Node realtime voice Agent / raw transport | `OpenAIRealtimeAgentSession` / `OpenAIRealtimeSession` |
| Browser realtime WebRTC peer | `OpenAIRealtimeWebRTCPeer` from `oneringai/realtime-browser` |
| Node document reading | `DocumentReader`, `readDocumentAsContent`, filesystem tools |

`isActive` means callable; `lifecycle` describes recommendation/migration. Token
limits can be `null`; use `resolveMaxContextTokens()` when a number is required.
Pure root/shared `getRealtimeModelCapabilities()`, `getTranscriptionCapabilities()`
and `assessModelParameters()` distinguish supported/unsupported/unknown endpoint
facts. Optional `parameterPolicy` affects selected OpenAI requests; old defaults
and raw provider controls remain strict. `VENDOR_PRESENTATIONS` /
`getVendorPresentation()` are presentation metadata, never auth/ownership authority.
Read [endpoint capabilities](docs/ENDPOINT_CAPABILITIES.md),
[parameter policy](docs/PARAMETER_POLICY.md) and
[vendor presentation](docs/VENDOR_PRESENTATION.md). Browser realtime credential/
WebRTC setup is in [the User Guide](USER_GUIDE.md#browser-and-mobile-webrtc-credentials);
it does not make the Node realtime Agent part of the browser root.

## Storage, tenancy and cleanup

- Set trusted `userId` on Agents and explicit identity/account scope where required.
- Use existing `StorageRegistry` slots and interfaces rather than hard-coding
  backends in plugins. Preserve legacy optional-identity/default-storage contracts;
  selected multitenant features still require their documented host scope.
- Preserve raw caller data; do not introduce silent lossy normalization, clipping
  or output caps. Distinguish source completeness, prompt selection, parser/storage
  bounds and model budgets. Existing documented opt-in limits/defaults remain part
  of v2 compatibility; changing them requires its own scoped review.
- Preserve errors with useful redacted diagnostics. Never print credentials to
  diagnose authentication, tool or storage failures.
- Call `destroy()` on disposable Agents, contexts and plugins. Await asynchronous
  client/runtime teardown; do not destroy borrowed resources. Save recoverable
  observations first. Cleanup/cancellation is not proof that a remote write failed.

## Documentation and source routing

| Need | Read |
| --- | --- |
| First integration / runnable examples | [README](README.md), [examples](examples/README.md), [User Guide](USER_GUIDE.md) |
| Public signatures / internal implementation inventory | Generated [API Reference](API_REFERENCE.md) / [Internal API](docs/INTERNAL_API.md) |
| Current v2 availability and adoption | [Version 2 Guide](docs/VERSION_2_GUIDE.md) |
| Browser export/build/storage boundaries | [Browser Agents](docs/BROWSER_AGENTS.md) |
| Custom plugin authoring and authority | [Authoring](USER_GUIDE.md#creating-context-plugins), [authority](docs/PLUGIN_PROMPT_AUTHORITY.md) |
| Release / migration | [Releasing](RELEASING.md), [migration](docs/PACKAGE_MIGRATION.md), [changelog](CHANGELOG.md) |
| Runtime architecture / delivery | [Architecture](docs/designs/AGENT_RUNTIME.md), [harness ledger](docs/designs/AGENT_HARNESS_DELIVERY_LEDGER.md) |
| Remote/server/desktop execution boundaries | [Distributed execution](docs/designs/DISTRIBUTED_AGENT_EXECUTION.md) |
| Staged architecture and compatibility requirements | [Roadmap](docs/designs/AGENTIC_ARCHITECTURE_EVOLUTION.md) |
| Consumer C1–C9 contracts and delivered scope | [API design](docs/designs/CONSUMER_COMPATIBLE_APIS.md), [delivery ledger](docs/designs/CONSUMER_DELIVERY_LEDGER.md) |
| Native compaction approved scope | [Stage 16A API](docs/designs/STAGE_16A_NATIVE_COMPACTION_API.md) |
| Offline/live baseline and compatibility fixtures | [Evaluation guide](docs/AGENTIC_BASELINE_EVALUATION.md) |

```text
src/core/                    Agent, Connector, tools, permissions, orchestration, storage
src/core/context-nextgen/    Context manager, plugins, assembly and compaction
src/agent-runtime/           Vendor-neutral sessions, backend and harness drivers
src/memory/                  Entity/fact system and adapters
src/capabilities/            Search, scrape, media, speech, embeddings
src/infrastructure/          Providers, runtime platform seams and persistence
src/browser/                 Generated compatible browser exports
src/tools/                   Built-in and connector tools / generated catalogs
src/connectors/              Auth, service templates and connector storage
examples/                    Runnable integration examples
apps/amos/                   Node terminal reference application
```

When source and documentation disagree, verify the public export and tests, then
fix the stale usage documentation in the same change. Dated delivery/review records
retain historical evidence; use current recipes for API signatures and release
receipts for publication, rather than treating old planning restrictions as an
unfinished implementation queue.

## Staged development and compatibility

Persistent user instruction (2026-10-07): develop authorized architecture changes
in stages with extensive meaningful tests, runnable examples and relevant AMOS
updates. Follow the roadmap's dependency-valid core order. Conditional work is
not a prerequisite. Reuse existing facilities before adding abstractions.

The approved Stage 16A API, Stage 14A, consumer C1–C9-C and harness H0–H6 are delivered;
the linked records own their validation/support limits. Earlier planning-only and
single-slice selection statements were superseded by the recorded implementation
authorizations. They do not require reimplementing completed work or authorize
consumer upgrades, another release, or later stages. Stage 14B, Stage 16B retention,
C3-R durable workflow recovery and production cursor backends remain deferred.
Preserve Stage 16A's existing strategy extension point/defaults; no replacement
configuration or mandatory migration is authorized.

For new authorized stage work:

- Implement the selected scope and complete its review/fixes/validation before
  continuing. A roadmap is not authorization for every stage; an explicitly
  authorized sequence should proceed without routine reapproval stops.
- Include regression, failure, lifecycle and compatibility coverage, plus mock
  integration when crossing subsystems. Cover cancellation, persistence,
  concurrency, budgets and authorization where relevant.
- Ship runnable examples with setup, expected behavior and cleanup; favor offline
  demonstrations and explicitly opt-in live modes. Update `examples/README.md`.
- Update AMOS when the capability can be used/inspected there and test the affected
  adapters/config/commands. Otherwise record why no AMOS change applies.
- Update the roadmap, Version 2 availability/adoption/handoff, affected public docs,
  examples, AMOS docs and release notes. Record defaults, support limits, persistence,
  failure behavior, compatibility and internal-only changes. Generate API docs.
  Distinguish current checks from historical totals and source from package availability.

**Backward compatibility is required wherever possible.** Prefer additive APIs,
optional configuration, legacy adapters and opt-in behavior. Preserve supported
signatures/defaults, extension contracts, raw returns, statuses/events, saved config/
session loading and protocol-v2 literal types/allowlists. Assess behavior and types.
For consumer hardening, breaking old agents is explicitly unacceptable: preserve
paired frozen-legacy/new-path gates and redesign a failing new path.

**If proposing a breaking change, stop the affected work**, explain the exact
change, reasoning, affected consumers, alternatives and migration, and obtain the
user's explicit approval before implementation. A major version, stage/branch
creation or general roadmap approval does not grant that approval. Record its scope.

Live LLM suites remain paused unless separately authorized. The completed bounded
Codex/light OpenAI validation on 2026-11-01 is historical and grants no standing
permission for additional billable tests. Read its
[record](docs/evaluations/LIVE_VALIDATION_2026_11_01.md) before making live-support claims.

## Repository validation

Use the smallest relevant checks while iterating, then broaden in proportion to risk:

```bash
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run examples:check
npm run docs:check
```

- `test:unit` scopes Vitest to unit tests; a bare Vitest sweep also includes live
  integrations. Never supply/print secrets to make integration tests pass, or excuse
  new failures using an old agent memory's claimed baseline.
- `npm run docs` / `npm run docs:full` regenerate public/internal API references.
  `docs:check` checks links/anchors, scripts and public imports; selected complete
  instruction/guide examples are typechecked against built declarations.
- For agent/context/tool contracts, build first, then run `npm run test:agentic:compat`
  and `npm run example:agentic-baseline`. `npm run examples:offline` exercises the
  complete deterministic example set; no provider credentials are required.
- Browser-sensitive changes also need `npm run example:browser-node`,
  `npm run test:browser:types`, `npm run test:browser` and, for published packaging,
  `npm run test:browser:package`. These cover page/Worker consumers and offline
  strict-CSP engines. Read the browser guide for Playwright prerequisites.
- Test affected AMOS types/build/units and documented offline examples using
  [its package scripts](apps/amos/package.json). Native terminal validation is
  separate from browser Agent validation. Record provider gates that were not run.
- Release work follows [Releasing](RELEASING.md), including `release:check`, the exact
  clean-tag publication gate, registry verification and the mandatory website handoff.
  Version/release scripts have commit/tag/push side effects; do not run them just to validate.

## Final checklist

- Named connectors, public imports and model/endpoint metadata verified?
- Shared ToolManager, unique tools and trusted host scope/permissions preserved?
- Browser-safe dependencies/storage/auth supplied for the selected environment?
- Plugin data separated from instructions, registered before checkpoint loading?
- Evidence/uncertain actions recoverable without replay; completion host-verified?
- Supported defaults, return/events and saved state still compatible?
- Relevant documentation/examples/AMOS and checks updated, with actual limits recorded?
- Branch, live-call, commit/push and publication authorization respected?

Reviewed against the v2 beta.3 public API on 2026-11-09; Agent behavior is unchanged
from beta.2.
