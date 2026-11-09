# Agents in browsers and Node.js

**First available in `oneringai@2.0.0-beta.2` (2026-11-08).** The earlier
beta.1 does not include this browser target. The current beta.3 examples include
the `context.model` field required by the public TypeScript configuration type.

Agents use the **same API in the browser and in Node.js**. Import `Agent`,
`Connector`, plugins, tools and supporting types from `oneringai`. Construction
stays synchronous; `run`, `stream`, direct calls, helpers, routing, context
preparation, permissions and persistence use the same implementations. There is
no `BrowserAgent`, runtime flag or initialization call.

## Shared application code

```typescript
// Documentation check: complete example
import { Agent, Connector, Vendor } from 'oneringai';
import type { ToolFunction } from 'oneringai';

// gatewayURL and appTools are supplied by the host application.
export function createAppAgent(gatewayURL: string, appTools: ToolFunction[]) {
  Connector.create({
    name: 'app-model', vendor: Vendor.OpenAI,
    auth: { type: 'none' }, baseURL: gatewayURL,
  });
  return Agent.create({
    connector: 'app-model', model: 'gpt-4o-mini', tools: appTools,
    context: { model: 'gpt-4o-mini',
      features: { workingMemory: true, inContextMemory: true } },
  });
}
```

The example assumes an application-owned, authenticated model gateway that
accepts the provider protocol. This change does not implement a gateway or an
authentication protocol. Existing API-key/no-auth, injected-provider and supported
rotating-credential connector options still apply. Browser code can read its own
credentials; keep privileged service credentials in your trusted host. Direct
vendor requests depend on that vendor's CORS and credential support. Offline
tests do not establish live vendor availability.

## Build and TypeScript setup

Browser-aware bundlers select the package's `browser` condition. Node retains
its existing ESM/CJS exports. Compatible `oneringai/shared`, `oneringai/types` and `oneringai/agents`
subpaths also select browser implementations. No application source aliases,
Node global shims, or backend imports are needed.

Select browser declarations explicitly in the application's TypeScript config:

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

For a dedicated Worker, use `ES2022` and `WebWorker` libraries instead of the
page DOM libraries. Register connectors/plugins and construct the Agent inside
that realm. Bridge UI actions explicitly through application messages. Tool
closures and live resources do not serialize across Workers. A Worker is
optional; the library does not move the loop automatically. Use a secure origin
(HTTPS or localhost) for Web Crypto. Strict CSP works without `unsafe-eval`,
including runtime helper and collection schemas.

## Custom context plugins

Feature keys are extensible. `workingMemory` and `inContextMemory` are built-in
features, not a closed list of allowed plugins. A developer can register a
factory and select it with the same context configuration:

```typescript
// Documentation check: complete example
import { Agent, PluginRegistry } from 'oneringai';
import { AppContextPlugin } from '../examples/browser-node/shared.js';

// AppContextPlugin extends BasePluginNextGen and implements ContextContributor.
PluginRegistry.register('app_context', config =>
  new AppContextPlugin('app_context', String(config?.currency ?? 'EUR')),
  { featureKey: 'appContext' });

const agent = Agent.create({
  connector: 'app-model', model: 'gpt-4o-mini',
  context: {
    model: 'gpt-4o-mini',
    features: { workingMemory: true, inContextMemory: true, appContext: true },
    plugins: { appContext: { currency: 'EUR' } },
  },
});
const plugin = agent.context.getPlugin<AppContextPlugin>('app_context')!;
agent.context.registerContextContributor(plugin.name, plugin);
```

Alternatively, construct the instance yourself and call
`agent.context.registerPlugin(plugin)`, then register its contributor. These are
separate alternatives; do not register two instances under the same name.
The factory key (`appContext`) and plugin name (`app_context`) have different
roles. Register a factory once per realm; `PluginRegistry.has` tests the feature
key. The complete [shared example](../examples/browser-node/shared.ts) exercises
both paths with different names, tools, revisions and checkpoint restoration.

Keep trusted guidance in `getInstructions()`, return `null` from `getContent()`
for this contributor pattern, and return application data from `contribute()`.
Plugin state updates must invalidate token caches and advance contributor
revisions. [Creating context plugins](../USER_GUIDE.md#creating-context-plugins)
explains the existing authoring API and authority rules.

Recreate/register plugins and contributors **before loading** a checkpoint.
Snapshots restore data, not executable factories, credentials, policies or
ModelTask authority. Manual registration after `Agent.resume` cannot restore
state already skipped during loading. Call `destroy()` during host teardown.

## Host capabilities and storage

| Capability | Browser target |
| --- | --- |
| Agent/context | Shared loop, built-in/custom plugins, managed/direct calls, streams, helpers, routing, compaction, external execution, orchestration and routine helpers |
| Providers | OpenAI, Anthropic, Gemini, Grok, DeepSeek and OpenAI-compatible text paths; existing capability gates still apply |
| Local tools | Any caller-supplied function allowed by its browser/Worker host; permissions use the same ToolManager |
| Built-in catalog | Nine existing JSON/routine tools; routine persistence requires supplied storage |
| External services | Generic authenticated connector API tools and compatible GitHub/Slack factories; existing remote tool/outcome transports |
| Memory | Shared MemorySystem and InMemoryAdapter with compatible supplied dependencies; Mongo and connector-backed embedder construction remain Node integrations |
| Host-only facilities | Filesystem/shell/desktop tools, document parsers, file storage/logging, OAuth/JWT credential acquisition, Vertex ADC, media generation, realtime Agent and native/managed harness implementations remain outside this target |

The Node root keeps its full 39 built-in tools and existing exports/defaults.
`web_fetch`, for example, reaches document parsers and stays host-only; a custom
`fetch` tool can use browser APIs subject to CORS. Microsoft/Google document tool
factories are not advertised as browser implementations. The browser inventory
is generated from canonical exports and tool metadata, not copied definitions.
The complete existing `oneringai/shared` and `oneringai/types` surfaces remain
available, including vendor presentation, parameter/endpoint capability metadata,
model registries, constants and type-only contracts. The browser root also exports
the compatible routine factories, routine keys, principal helpers and in-memory
history storage used alongside Agents.

Working memory and enabled evidence retain their existing in-memory defaults.
They do not become durable because the loop runs in a browser. For checkpoints,
supply the existing context/session `storage` interface. For legacy persistent
instructions, user info, routine definitions and suspension correlations, supply
their existing storage options or StorageRegistry slots: Node's disk defaults
are explicitly unavailable in the browser. No IndexedDB adapter is added.
Node protected/public Buffer contracts are unchanged. Browser media-storage,
audio, image, video and embedding byte contracts use `Uint8Array`, without
importing their host implementations or installing a global Buffer type.

Helper schemas and optional `validationSchema` retain independent local roots.
URN identifiers, local fragment references and nested `$id` scopes work under
strict CSP. Collection validation preserves Node's existing non-strict behavior:
unknown keywords, including legacy `extends`, `disallow` and `divisibleBy`, are
ignored. Helper validation continues to reject unknown keywords. Neither path
mutates caller schemas or data.
References into annotations such as `default`, `examples` and `const` receive the
same descendant checks when used as schemas. `const`/`enum` literal comparisons
remain exact even when their payload is also referenced. Invalid reachable schemas
fail before model dispatch. Empty `$id` values and `"#"` follow the native compiler's
anonymous-root caching behavior, including `"#/"`. Resource discovery also indexes
IDs in metadata without validating unused metadata as schemas. Helper strict
admission matches Node's pattern/property overlap and tuple-only `additionalItems`
rules. Inactive conditional and collection branches remain ignored unless
explicitly referenced; whole-schema metadata validation still applies.

Browser shutdown/background throttling can interrupt work. Save explicit
checkpoints; use an acknowledged durable evidence backend when restart recovery
is required. A failed acknowledgement or cancelled request does not prove that
an external write failed. Preserve the observation, repair storage, acknowledge
it, and continue without replaying the action. See [durable evidence](DURABLE_EVIDENCE.md).

ModelTask accounting stays explicit and local to its JavaScript realm. Shared
tasks reserve calls/tokens before dispatch and track retries and unknown usage;
they are not a server-enforced spending boundary. Node retains AsyncLocalStorage;
browser transports capture invocation ownership per operation without patching
global fetch or Promise. Custom-provider attestation requirements stay unchanged.

## Measured limits and verification

A million-token model window does not imply a million-token local model. The
browser holds text, metadata and serialized requests; inference still happens at
the configured provider. Context preparation, copying and serialization can
block a page thread. A Worker can keep that work away from UI event handling.

The deterministic scale fixture uses 3,500,000 UTF-8 input bytes, estimated as
1,000,000 tokens by `simpleTokenEstimator` (not a provider tokenizer), with a
scripted local provider. It records preparation/run time, serialization, timer
delay and available heap readings. Its configured model capacity is explicit;
no framework quotas were raised. Results vary with engine, device, data and
plugins. The [delivery record](designs/AGENT_BROWSER_NODE_DELIVERY.md) records
actual engine versions, measurements and the substantial current bundle size.
Synchronous provider construction and vendor icon metadata retain multiple SDKs
and assets; this refactor does not introduce an async provider loader.

From this checkout, after installing dependencies:

```bash
npm run build
npm run example:browser-node
npx playwright install chromium firefox webkit
npm run test:browser
npm run test:browser:types
npm run test:browser:package
```

The browser runner uses Playwright Chromium/Firefox/WebKit, a local
scripted gateway and a strict-CSP page/Worker. There are no provider keys, live
LLM calls or external actions. It closes browsers, agents, Workers and the gateway.
The demonstration session store is realm-local memory; replace it with an
application backend for durable sessions. For Node 22 package verification, set
`ONERINGAI_NODE22` to that executable's path. Native AMOS remains a Node terminal
consumer, using its existing Agent configuration and host tools.
