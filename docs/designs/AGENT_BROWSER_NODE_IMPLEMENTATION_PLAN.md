# Agent browser and Node implementation plan

Date: 2026-11-08. Revision: 2. Status: implementation approved on 2026-11-08;
the user's subsequent instruction requires development directly on main.

Make the existing Agent and context plugin system run in supported Node versions,
modern HTTPS browser pages, and dedicated browser Workers. Keep the same public
imports, classes, configuration, methods, tool pipeline, and plugin APIs. Share
the agentic loop, context preparation, plugin algorithms, permissions, and model
budget ledger. Isolate environment facilities through a few private dependencies
selected by the build.

## Scope and authorization

Approval authorizes P0 through P6 sequentially, including review, corrections,
tests, examples, and documentation after each stage. Complete each stage's checks
before continuing, without routine approval stops between stages. P0 is a bounded
compatibility gate for difficult substitutions, not authorization for a general
runtime framework or replacement validation engine.

Preserve existing working-tree changes and prior committed work. Recheck main and
the working tree and record the actual source baseline before implementation.
Develop directly on main, as explicitly instructed by the user, and keep unrelated
work intact. Approval does not include commits, pushes, merging,
publication, consumer upgrades, changes to oneringplatform, or billable model calls.

Public or behavioral breaking changes require a separate specific proposal and
approval under the repository compatibility rule. Failed compatibility checks do
not authorize narrower supported behavior, weaker validation, or a larger rewrite.
If a required substitution cannot satisfy the contract with a small private
adapter, preserve unaffected work and present the concrete incompatibility and
alternatives before expanding the affected scope.

## Compatibility contract

| Surface | Requirement |
| --- | --- |
| Imports and construction | Continue importing from oneringai. Agent.create, Connector.create, plugin factories, and registration remain synchronous. No BrowserAgent, required browser subpath, runtime option, async factory, or application bootstrap call. |
| Agent API | Preserve configuration, managed/direct execution, helpers, routing, compaction, external execution hooks, controls, async continuation, persistence methods, results, events, and callbacks. |
| Context and tools | agent.tools and agent.context.tools remain the same ToolManager. Preserve plugins, strategies, explicit contributors, instruction/data authority, permissions, evidence, and pending-dependency protections. |
| Custom plugins | Preserve IContextPluginNextGen, BasePluginNextGen, PluginRegistry, direct registerPlugin, custom feature/config keys, factory context, lifecycle, compaction, ownership, tools, and state handling. |
| Existing Node consumers | Preserve exports, Node ESM/CJS resolution, file defaults and migrations, environment behavior, exception identities, protected/subclass contracts, and optional harness integrations. |
| Persistence and protocols | Preserve supported formats, JSON semantics, versions, canonicalization, digests, and restoration guards. Serialized data does not restore code, policy authority, credentials, or ModelTask authority. |
| Failures and accounting | Preserve synchronous admission, retries, cancellation, unknown usage/completion, late settlement, storage failure recovery, and no-replay boundaries. |

The shared Agent API remains the same. The browser root is a new environment
target containing compatible exports; the full Node root remains unchanged.
Node-only facilities are not replaced with dummy implementations or silently
weakened policies. Browser-unsupported imports or selections fail explicitly.

Shared application source does not mean identical credential/storage setup in
every host. Existing dependency-injection interfaces provide that setup without
changing Agent code. Ordinary browser build/TypeScript target configuration is
documented below and is separate from the public runtime API.

## Delivery boundary

| Area | Browser scope | Existing Node behavior |
| --- | --- | --- |
| Agent and context | All existing environment-independent Agent operations and built-in/custom context algorithms, including compatible memory integration, run in a page or Worker | Preserved |
| Tools | Caller-supplied browser functions, existing remote tool/outcome transports, portable built-ins, and connector factories whose complete dependency path is compatible | Full existing inventory preserved |
| Providers | Existing OpenAI, Anthropic, Gemini, Grok, DeepSeek, and OpenAI-compatible generation/streaming paths, capability gates, routing, helpers, and supported native compaction; existing provider injection | All existing providers preserved |
| Connector authentication | Existing API-key, no-auth, injected-provider, and currently supported rotating-key paths; authenticated fetch using the configured browser-appropriate credential | Existing OAuth/JWT acquisition and other auth behavior preserved |
| Storage | Existing supplied interfaces and StorageRegistry slots; current in-memory defaults stay in memory | Existing defaults, including file backends, preserved |
| Runtime lifetime | Explicit checkpoints and recovery within browser lifecycle constraints | Existing process lifetime behavior preserved |

Browser OAuth/JWT credential-acquisition flows, Vertex ADC, private-key paths,
native shell/desktop tools, file logging, and filesystem backends are host
integration facilities outside this browser delivery. Remove their eager
dependencies from ordinary browser construction while preserving Node behavior.
Privileged services can be reached through existing remote tools or a gateway;
this plan does not build that gateway or a new authentication protocol. No
browser OAuth implementation or token-encryption rewrite is needed for the Agent
port. Do not substitute plaintext for an existing encrypted token store.

Use existing baseURL/auth options or provider injection for a model gateway.
Direct provider access still depends on its CORS and authentication support.
Scripted transport tests establish library behavior, not live vendor availability.

The browser target includes Agent/context classes, their public supporting types,
compatible registries, plugins, strategies, permissions, ModelTask, portable remote
tools/outcomes, and existing orchestration/routine helpers that need only the same
portable utilities. Audit these shared exports together. Existing image/media,
document, realtime-agent, and agent-runtime/harness implementations are not ported
by implication; retain their current environment boundaries and existing subpaths.

Do not move Agent into a Worker automatically. The host constructs it there,
imports/registers its plugins there, and bridges UI operations explicitly. Tool
closures, factories, policies, and live resources are not serialized to create a
second tool pipeline. A Worker is an execution host, not a new authorization model.

## Internal design

### One shared core with small host dependencies

Keep Agent.ts, BaseAgent.ts, AgentContextNextGen.ts, plugins, strategies, permission
algorithms, and ModelTask bookkeeping shared. Introduce only small private modules
for facilities that actually differ: primitives, logging/environment access,
storage defaults, and transport/host-provider integration. Select implementations
within the package build. Applications need no source aliases or public runtime
object. Do not introduce another provider, plugin, storage, or capability registry.

Reuse standard fetch, streams, abort signals, clocks, timers, text encoding, and
typed arrays where semantics already match. Preserve Node's native primitive
behavior and timer unref through the Node implementation rather than forcing
Node onto browser replacements. Do not add global Buffer/process/require shims,
patch global fetch/Promise, or pull general Node polyfills into the browser graph.

Preserve synchronous hashing and comparison wherever construction and final
admission require them. Retain native Node crypto and strict equality. Qualify
small existing browser implementations in P0; narrowly imported hash/HMAC and
AES-GCM libraries are candidates because collection continuations require those
operations synchronously. Do not implement crypto or a general-purpose comparator
from scratch, or convert public synchronous methods to promises.

Differential tests cover the actual accepted values and bytes, including Unicode
and lone surrogates, base64 variants, prototypes, special numbers, dates, typed
arrays, array holes, maps/sets, and cycles where accepted. Never narrow accepted
data to make a replacement pass. Preserve canonicalization, authenticated cursor
layout, quotas, and evidence hashes. Production cursor keys remain manager-local;
shared-key crypto vectors are test-only. Source implementation fingerprints still
regenerate normally after source changes.

### Model accounting with preserved Node execution semantics

Keep one reservation, retry, usage, and settlement implementation. Extract ambient
invocation access behind a private transport-binding boundary. Preserve the
existing Node AsyncLocalStorage implementation and its execute/iterate behavior;
removing it from Node is not necessary for browser support.

The browser implementation uses explicit per-operation binding. At provider
entry, resolve the binding from the exact framework-issued operation signal or
an equivalent private token, then capture it in an invocation-owned fetch closure
before the SDK combines or replaces signals. Do not recover ownership from an
SDK-generated Request signal. Bindings survive lazy stream pulls, retries, early
consumer exit, and outstanding late work until safe cleanup.

Use existing scoped-client/fetch facilities only where necessary for the browser
path: OpenAI/Anthropic withOptions and Google client httpOptions.fetch are concrete
seams to verify. Do not recreate converters or their conversation/signature state,
mutate a shared client's transport, or create a global current-invocation slot.
Preserve endpoint/account snapshots, credential callbacks, timeouts, retries, and
untracked auxiliary count/discovery requests. Node's ordinary client path does
not acquire per-call client allocation as a side effect of this work.

ModelTask.execute/iterate and ITextProvider keep their signatures. Existing custom
provider injection remains usable. Preserve current hard-limit rejection and
customProviderAttempts attestation rules; do not claim instrumentation for an
arbitrary provider that does not supply it. Shared budgets remain local to the
explicit ModelTask/JavaScript realm, not a new distributed or tamper-proof budget.

### Storage and plugin dependencies

Preserve each call site's existing resolution and lifetime semantics, including
explicit configuration, StorageRegistry configuration/context, and its current
default. Private host-selected factories replace only the host default. Do not
eagerly register defaults, alter singleton/factory scope, or resolve disabled
features.

Node retains file defaults. Browser working memory and evidence retain existing
in-memory semantics. Features whose defaults require disk, including legacy
persistent instructions, user info, and suspension correlations, use the existing
configured storage slots. Report missing storage explicitly instead of silently
substituting temporary memory. New IndexedDB adapters and storage RPC APIs are
outside scope.

Preflight storage requirements when known from configuration. An arbitrary tool
can signal suspension after an action; if storage then fails, preserve the actual
observation and existing recovery behavior. Never repeat the action to repair
storage or infer that it did not happen.

Split shared/in-memory evidence code from file storage without changing exported
or protected Node Buffer contracts. Keep necessary Node conversions at the file
or existing extension boundary. Use direct internal imports where barrels pull in
unrelated modules; retain public re-exports and class/exception identity. Clean up
incidental environment/byte use in portable memory integration without porting
database adapters or introducing a second MemorySystem.

Both custom-plugin registration paths remain unchanged:

    PluginRegistry.register('app_context', factory, { featureKey: 'appContext' });
    const agent = Agent.create({
      connector: 'app-model', model, tools,
      context: {
        features: { appContext: true },
        plugins: { appContext: { currency: 'EUR' } },
      },
    });

    // Separate alternative using a host-constructed instance:
    agent.context.registerPlugin(pluginInstance);

Do not register both examples under the same name in one context. Preserve current
dependency checks, factory ordering, custom-key behavior, collisions, ownership,
tool registration, hooks, token caches, compaction, and cleanup. Keep built-in
initialization as it is rather than converting it to another registration scheme.
Explicit context contributors retain their current API and authority rules.

Recreate/register custom plugins before loading their saved state. For manual
registration, supply a context with the plugin already registered or register
before explicit load; registration after Agent.resume cannot recover state already
skipped during load. Factories and contributor callbacks must exist in each host.
Preserve borrowed-context ownership and rollback behavior.

### Providers and one catalog source

Keep synchronous provider construction, shared converters, capabilities, errors,
and native state guards. Isolate host-only provider/auth construction and configure
browser SDK operation internally, without a new public browser flag. Do not change
AI-provider OAuth/JWT support, rotating-key vendor restrictions, or other existing
configuration rules as part of portability.

Derive the browser tool catalog from the same canonical definitions and metadata
as Node. Add private generation-time capability selection where needed; do not
maintain a second list of tool definitions, descriptions, schemas, or hashes.
Node's inventory and initialization behavior remain unchanged. Preserve registration
side effects, identity filtering, and current require fallbacks on the Node path;
the browser path uses internal module wiring instead of require.

Check full dependency graphs, including lazy imports and connector factory
registration. Current web_fetch, for example, reaches document parsers. Such a tool
stays host-only unless its complete existing implementation is portable; do not
silently publish a reduced tool under the same name. A factory needing an unavailable
host must not be advertised as executable in the browser. Existing caller-defined
and remote tools continue through the one ToolManager and existing permissions.

### One validation boundary for runtime schemas

Keep the Node AJV configuration, compile lifetime, and validation/repair behavior
unchanged. Add a private synchronous validation boundary at the existing helper
and collection-contract sites, preserving their different options. Use one
CSP-compatible browser implementation for both sites.

Collection schemas are derived and modified at runtime from tool definitions;
arbitrary helper schemas are also runtime inputs. Do not make this delivery depend
on precompiling all schemas or on generated copies of runtime schema logic. Do not
add a schema registry, compilation service, or unsafe-eval fallback.

A browser schema library is not assumed interchangeable with AJV. P0 must qualify
it against current schema admission and validation, including supported drafts,
AJV-accepted extensions such as nullable, invalid keyword types, formats,
Unicode/pattern/numeric cases, references and siblings, duplicate IDs, and the
separate validationSchema root. Invalid schemas and unresolved references must
fail before model dispatch as they do today. Preserve non-coercion/non-mutation,
repair limits, exception types, and required diagnostics.

@cfworker/json-schema may be evaluated, but its support claims alone are not
approval to use it. A small explicit compatibility adapter is permitted; a new
handwritten schema engine, narrower public schema contract, or silent validation
change is not. If no small compatible solution passes, report that specific
blocker before expanding scope. Strict-CSP dynamic-schema support remains a
required completion gate, not an unannounced optional feature.

### Package exports and TypeScript resolution

Add a browser condition ahead of the existing fallback targets without changing
Node's normal ESM/CJS or default declaration resolution. Both targets compile the
same core sources with small host dependencies. A curated browser export entry
does not duplicate implementations. Preserve existing subpaths; audit compatible
shared/types/realtime-browser declarations separately. Native/managed runtime
subpaths retain their existing host requirements.

Browser TypeScript fixtures select the browser condition explicitly using modern
module resolution and customConditions containing browser. Test and document this
normal project setting; selecting browser JavaScript in a bundler does not ensure
TypeScript selects browser declarations. Verify a default Node TypeScript consumer
still sees the original exports. Compile separate page and Worker type fixtures
with types empty and skipLibCheck false; the Worker fixture must not inherit DOM
page globals. Inspect the resolved declaration graph to ensure dependencies do
not import Node ambient declarations implicitly. Resolve transitive optional Node
types without a global public binary-type migration, declaration patching, or
misleading stubs.

Test both client and server builds with package resolution. Preserve class and
registry identity within each environment/module format, including Node root/runtime
identity; no cross-realm object identity or mixed-ESM/CJS singleton unification is
promised. Extend the export verifier to walk nested conditions and verify actual
resolution as well as file existence. Do not blanket-mark registration modules
side-effect-free.

Synchronous provider construction can retain multiple browser-compatible SDKs in
the graph. Measure raw/compressed bundle size and dependency inventory rather than
adding an asynchronous provider loader or mandatory provider registry to optimize
size. Exclude Node backends, native SDKs, and server parsers; broader package-splitting
optimization is not part of this refactor.

## Delivery stages

| Stage | Deliverables and exit criteria |
| --- | --- |
| P0 Baseline and compatibility proofs | Record the approved source/API/extension baseline and exact compatible export/tool inventory. Add reusable contract fixtures. Prove browser transport binding, synchronous primitives/comparison, and dynamic schema compatibility before broad edits. Reuse successful proof code/tests in delivery rather than building throwaway frameworks. No browser-support claim until later package/runtime gates pass. |
| P1 Private primitives and diagnostics | Introduce the small host dependencies and replace incidental Node use in shared core, memory integration, portable outcomes, and routine/orchestration utilities. Primitive/serialization differential tests and existing focused Node regressions pass. |
| P2 Storage and plugins | Split evidence/file dependencies, preserve lazy defaults, trim internal import edges, and verify all plugins with compatible supplied backends. Manual/registry plugins, contributors, tools, lifecycle, compaction, authority, save/load, and rollback pass. |
| P3 Browser transport ownership | Isolate the existing Node ALS path and add browser per-operation binding with shared accounting. Actual SDK serialization/retry/concurrency tests pass; no-task calls, custom providers, helpers, counts, streams, cancellation, and late work retain their correct owner. |
| P4 Providers catalogs and schemas | Finish browser-compatible provider construction, host-only auth/provider isolation, the generated catalog projection, and the qualified browser schema adapter. Runtime-generated collection and helper schemas work under strict CSP; existing Node behavior remains. |
| P5 Package delivery | Deliver conditional builds/declarations and recursive export checks. Extract the package and verify unchanged Agent usage in Node ESM/CJS and browser page/Worker, explicit TypeScript conditions, supported client/server builds, and absence of server dependencies in browser output. |
| P6 End to end verification and documentation | Complete shared behavioral, recovery, and large-context scenarios; run the broad Node and browser checks; ship runnable examples and accurate public documentation/delivery records. All required completion gates below pass. |

Each stage includes review and corrections before continuing. Run relevant checks
while iterating and broaden at integration points; do not rerun the entire matrix
without a new change or unresolved concern. Serialize clean/build commands with
checks that consume dist. Keep proof failures and environmental gaps explicit.

## Completion gates

| Area | Required evidence |
| --- | --- |
| API and Node compatibility | Unchanged public Agent/config/plugin consumer fixtures, synchronous construction, protected/subclass extension fixtures, ESM/CJS resolution and existing root/runtime identity, file defaults/migrations, and AMOS regressions. |
| Real browser execution | Packaged import and actual Agent run/stream in Chromium, Firefox, and WebKit page and Worker hosts; public supporting types compile without ambient Node globals. Use representative core cases in every host and the shared substantive contract suite across them. |
| Agent and plugins | Managed/direct calls, helpers, structured repair, routing, compaction, controls, external hooks, async tools, all built-in plugins with suitable backends, both custom registration paths, explicit contributors, lifecycle/ownership, and state restoration. |
| Model ownership | Interleaved agents/helpers and supported shared-provider operations; shared ModelTask reservations; physical retries and untracked counts; credential callbacks; lazy stream pulls/return; cancellation, unknown usage, early close, and late settlement. Node ambient tracking tests remain valid. |
| Storage and authority | Missing/corrupt/expired/failed evidence, pending raw protection, suspension storage failure, rollback, stale host scope, permission/identity filters, protected task state, and no replay of accepted or uncertain writes. |
| Protocols and portability | Stable digest/crypto vectors and protocol versions; manager-local cursor lifetime; normal snapshot round trips under matching host bindings. Native/opaque provider state is restored only when existing model/connector/endpoint/principal/evidence guards accept it. No new mandatory environment field or bypassed guard. |
| CSP and dependencies | Runtime-derived collection schemas and dynamic helper/validationSchema under a strict-CSP host, with no unsafe-eval; no Node built-ins, server backends/parsers, optional native SDKs, unguarded Node globals, or unresolved require in the supported browser graph. |
| Scale and packaging | Measured bundle/dependency inventory and a synthetic million-token-equivalent context using scripted transport. Record actual bytes, estimator, preparation/serialization time, responsiveness, and available memory measurements with host versions. Do not raise quotas, claim precise model tokens, or invent universal speed/memory guarantees. |

Use a dedicated local browser fixture whose policy permits its same-origin
scripts, Worker, and scripted gateway. The platform's present CSP and gateway
limits remain separate integration work. Browser/tab termination cannot be turned
into guaranteed background execution; preserve explicit checkpoint and uncertain
action recovery instead.

Run Node consumer/contract fixtures on Node 22.13 and Node 24, and the broad suite
on an available supported host. Record actual browser/Node/tool versions and
unavailable required coverage. A skipped required gate is not a pass. Browser
runner dependencies remain development-only. No real credentials are needed.

Retain existing build, typecheck, lint, unit, example, built-package compatibility,
and documentation checks:

    npm run build
    npm run typecheck
    npm run lint
    npm run test:unit
    npm run examples:check
    npm run test:agentic:compat
    npm run examples:offline
    npm run docs
    npm run docs:full
    npm run docs:check

Add focused browser-runtime, browser-type, dependency-boundary, and extracted-package
checks as development scripts. Pack with lifecycle scripts disabled and temporary
output/cache paths; do not run version/release commands.

Ship shared offline scenarios hosted by Node, a browser page, and a Worker. Cover
the real loop, local/remote tools, a custom plugin through each registration path,
an explicit contributor, and a checkpoint round trip. Keep task logic and Agent
configuration shared; vary only host transport/storage setup. Document setup,
expected output, plugin-before-load requirements, ownership, cleanup, and lifecycle
limits. Existing Node AMOS remains a regression consumer, not a new browser UI.

Update README, USER_GUIDE, examples/README, relevant context/evidence/model-task
recipes, CHANGELOG, and the Version 2 adoption/documentation handoff. Regenerate
registries and API references through existing generators. Record stage results,
resolved dependencies, exact browser capability inventory, compatibility evidence,
and integration limits in a delivery record. Distinguish branch availability from
a verified package release.

## References

- [Agent and loop](../../src/core/Agent.ts)
- [Base construction and provider ownership](../../src/core/BaseAgent.ts)
- [Context implementation](../../src/core/context-nextgen/AgentContextNextGen.ts)
- [Plugin registry](../../src/core/context-nextgen/PluginRegistry.ts)
- [Plugin and context contracts](../../src/core/context-nextgen/types.ts)
- [Current plugin prompt authority](../PLUGIN_PROMPT_AUTHORITY.md)
- [Model task and transport accounting](../../src/core/model-execution/ModelTask.ts)
- [Provider factory and current auth restrictions](../../src/core/createProvider.ts)
- [Evidence implementations](../../src/infrastructure/storage/EvidenceStorage.ts)
- [Runtime collection schemas](../../src/tools/connector/pages/contract.ts)
- [Helper schema validation](../../src/core/model-execution/ModelExecutor.ts)
- [Build](../../tsup.config.ts)
- [Package export verification](../../scripts/verify-package-exports.mjs)
- [Capacity boundaries](../CONSUMER_CAPACITY_INVENTORY.md)
- [Stage 00 compatibility and evaluation](../AGENTIC_BASELINE_EVALUATION.md)
- [Node conditional exports](https://nodejs.org/api/packages.html#conditional-exports)
- [TypeScript custom conditions](https://www.typescriptlang.org/tsconfig/customConditions.html)
- [Web Crypto digest behavior](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest)
- [AJV CSP guidance](https://ajv.js.org/security.html#content-security-policy)
- [Browser schema candidate and documented support boundaries](https://github.com/cfworker/cfworker/tree/main/packages/json-schema)
