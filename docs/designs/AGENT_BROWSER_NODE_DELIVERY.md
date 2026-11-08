# Agent browser and Node delivery

Date: 2026-11-08. Approved scope: [revision 2, P0–P6](AGENT_BROWSER_NODE_IMPLEMENTATION_PLAN.md).
Development is directly on `main`, as explicitly instructed. Only
`codex/provider-instruction-authority` was merged, by authorized fast-forward to
`f0cb9cd743c669a0f8e37431ce1930b9bc8d8e6e`. No other merge, new branch, publication,
consumer upgrade, or billable provider call was part of the initial delivery.
The subsequent explicit instruction authorizes the final review fixes, a commit
and push on main, and the `2.0.0-beta.2` npm release; see
[beta.2 evidence](../evaluations/BETA2_RELEASE_VALIDATION_2026_11_08.json).

## Availability

P0–P6 are implemented and included in **2.0.0-beta.2**. Agents use the same public
API in browsers and Node.js; the shared loop, context algorithms, plugins,
permissions, evidence and budget ledger have not been forked. No public runtime
object, bootstrap call, async factory, replacement registry or storage adapter
was introduced. The earlier beta.1 does not include this change.

The beta.2 package is registry-install verified from `v2.0.0-beta.2` / `4934f066`.
Both `latest` and `next` select it; the beta.2 evidence record contains the immutable
artifact integrity and fresh Node/browser verification after npm processing completed.

| Stage | Delivered work | Validation |
| --- | --- | --- |
| P0 | Qualified synchronous crypto/comparison and CSP schema adapter; actual SDK transport seams | 186 schema cases against AJV; 16 Node 22 comparison vectors; six crypto vectors; strict-CSP page/Worker |
| P1 | Private primitives, environment, diagnostics and byte operations | Native Node semantics retained; focused context/model/evidence 1,602 tests, diagnostics/memory/portable 1,621 tests; final broad suite |
| P2 | Host default factories and shared evidence algorithm with native Buffer boundary | Storage/OAuth/connector/plugin checks: 1,699 tests; Node protected-subclass test; all ten built-in plugins and both custom registration paths in six browser hosts |
| P3 | Native ALS boundary and explicit browser invocation-owned SDK fetch | 218 focused provider/model tests, binding lifecycle tests, physical retries, interleaving, hard shared budgets, cancellation/late work, unknown usage, lazy/early stream exit |
| P4 | Browser SDK construction, host-only auth/Vertex isolation, one generated tool projection, dynamic schema boundary | Actual runtime collection schemas, helper/validationSchema and repair under CSP; manager-local authenticated cursors; unchanged Node AJV configuration |
| P5 | Conditional root/shared/types/agents exports, browser declaration graph, recursive export checks | Extracted ESM/CJS package on Node 22.13.1 and 24.20.0; page/Worker types with no Node ambient and skipLibCheck false; supporting subpath singleton checks |
| P6 | Shared examples, recovery/accounting/scale/host matrix and public documentation | Chromium/Firefox/WebKit pages and Workers; full Node suite, AMOS, thirty offline examples and documentation checks |

## Implementation and compatibility review

Private runtime dependencies select native Node crypto, comparison, process hooks,
file logging/storage defaults and ALS, or the browser equivalents. The browser
uses narrowly imported noble SHA-256/HMAC/AES-GCM and assert's established strict
comparison implementation with a small type-predicate dependency. There are no
public Buffer/process/require shims or global fetch/Promise patches. Node keeps its
native comparator, including Node-version differences, and timer unref behavior.

Evidence quota/queue/integrity/retrieval logic is shared once. Node memory and
file stores retain protected Buffer signatures, verified in source and packed
consumer subclasses. StorageRegistry's optional media byte type is privately
selected (Buffer on Node, Uint8Array in browser declarations), with no global
binary-type migration. Disk-backed browser defaults and file logging selections
fail explicitly; disabled plugins do not resolve storage.

One ModelTask ledger remains shared. Node retains ambient AsyncLocalStorage;
browser bindings use the exact framework operation signal, reference-counted
lifetimes and SDK-scoped fetch closures captured before SDK signal rewriting.
OpenAI/Anthropic withOptions and Google's httpOptions.fetch do not mutate shared
clients or converters. Ordinary Node clients are not allocated per call. Counting
and discovery remain auxiliary/untracked. Arbitrary custom providers still need
the existing attestation, not an invented transport-instrumentation claim.

Node keeps AJV and its existing caller lifetimes/options. The browser uses
jsonschema's per-instance keyword hooks, existing ajv-formats predicates and a
generated fixed admission meta-schema. Caller schemas remain dynamic and
interpreted; no unsafe-eval or schema-compilation service is used. The adapter
preserves the tested admission, nullable, Unicode, numeric, format, reference,
duplicate-ID, prototype/inherited-property and nonmutation behavior, including
separate local validation roots. AJV's rejection of a nested ID directly aliasing
its own fragment is retained; the supported allOf form is tested. The 186-case
corpus is meaningful differential evidence, not exhaustive JSON Schema equivalence.

Compatible exports are projected from canonical declarations; tool definitions,
schemas, hashes and registration side effects have one source. The browser has
nine existing JSON/routine catalog tools. Node retains all 39. Native/managed
harnesses, document/media implementations, filesystem/desktop tools, Mongo,
OAuth/JWT acquisition and Vertex remain host integrations. Unsupported factories
are not advertised as browser implementations. Generic API and GitHub/Slack tools
remain available. Runtime collection tests exercise real registration and cursor
logic, rather than a replacement paging fixture.

## Review corrections

All reported findings, the latent collection-validation gap, and the separately
identified AMOS EOF loop are fixed in main source:

- Preserve every canonical `shared`/`types` export and reuse those declarations
  when projecting the root. Restore compatible routine factories/keys, principal
  helpers and in-memory history storage. Extracted consumers check all **53 shared
  names (27 runtime)** and **599 types names (147 runtime)**, plus singleton identity.
  Browser media/embedding contracts use the existing private byte-type boundary;
  Node's Buffer signatures remain exact.
- Reuse AJV's dependency-free RFC 3986 URI resolver (`fast-uri`, qualified at
  3.1.9 after the release security review) and restore lexical scope at each interpreted schema entry. URN roots,
  nested IDs under allOf/anyOf/oneOf/not, referenced child roots and optional local
  validation schemas work without eval. Per-compiler identity/caching is unchanged.
- Ignore unknown collection extensions only at actual schema nodes in the cloned
  schema. Preserve property names and const/enum/default data. Known constraints
  remain enforced; strict helper admission still rejects unknown keywords.
- Preserve leading UTF-8 BOMs with TextDecoder's `ignoreBOM` option. Differential
  malformed/Unicode byte vectors and real packaged GitHub reads cover the change.
- Track AMOS input closure, settle pending prompts/reads and avoid reopening EOF
  input. Shared question cleanup preserves temporary prompts and removes listeners.
  Tests cover real closed-stdin subprocesses as well as lifecycle/listener cases;
  compiled AMOS exits successfully on closed stdin and passes TTY `/help`/`/exit`.

Each of the six browser realms executes **32 public helper invocations** covering
both primary and optional validation roots, plus twelve invalid-schema cases rejected
before dispatch and the GitHub BOM regression. The
186-case adapter corpus also passes against a Node 22 oracle in a strict-CSP page
and Worker. These additions close the review's missing coverage; they do not claim
exhaustive JSON Schema equivalence or live-provider validation.

## Final verification

The machine-readable [beta.2 record](../evaluations/BETA2_RELEASE_VALIDATION_2026_11_08.json)
contains the final gates, host reports, scale measurements and package checks.
The [earlier validation record](../evaluations/BROWSER_NODE_VALIDATION_2026_11_08.json)
retains the original qualification and packed dependency inventory.
All tests use offline synthetic/local transports; no credentials or live-provider
CORS claims are made.

- Full Node unit suite: **9,478 tests / 435 files pass**, including AMOS tests.
- Build, library typecheck, lint, examples typecheck, Stage 00 built-consumer
  compatibility, public/full API generation and documentation checks pass.
- AMOS build and typecheck pass. No browser AMOS UI is needed: its terminal tools
  are intentionally Node integrations; the existing consumer API is unchanged.
- **30 offline examples pass**, including the new shared scenario and existing
  AMOS/native compaction/remote outcome/routine/harness examples.
  All **14 AMOS offline examples** also pass independently.
- Extracted tarball: Node **22.13.1 and 24.20.0**, ESM and CJS, native file exports,
  root/runtime registry identity, synchronous construction, shared ToolManager,
  protected Buffer overrides and unchanged IMediaStorage Buffer type pass.
- Separate page and Worker consumers use types empty and skipLibCheck false;
  the resolved browser declaration graph contains no @types/node. The existing
  realtime-browser peer declaration is also checked in the page consumer.
- Real packaged runtime: **Chromium 158.0.8127.18, Firefox 159.0, WebKit 27.2**,
  each in a page and a dedicated module Worker. No page errors or CSP violations.
  Strict policy: default/script/connect/worker sources self, object none, base-uri none.
- Every browser host checks run/tools/stream/helpers, both custom plugin paths and
  contributor authority, all built-in plugins with supplied backends, state restore,
  rollover/task scope/revisions, shared reservations, retries, cancellation/early
  stream closure/late work, unknown usage, structured repair, external execution,
  async cancellation, suspension storage failure, runtime collections/cursors,
  evidence failure/protected checkpoint recovery, permissions and authenticated
  remote receipt reconciliation without replaying accepted writes.
- Schema/crypto/comparison probes use a Node 22 oracle and a strict-CSP Chrome
  page/Worker. Raw schema candidates failed qualification; only the bounded adapter
  is used. SDK seam probes separately cover async credentials, physical retries,
  concurrent clients and auxiliary requests for OpenAI/Anthropic/Google.

Dependencies in tarball tests are reused locally; this is an extracted-package
resolution/runtime check, not a new clean-install security audit. Browser API
behavior is tested against scripted provider protocols, not real billable services.
Baseline before portability was 9,416 units / 428 files and 29 offline examples.
Initial sandbox socket failures were rechecked with local socket permissions.
One early overlapping clean/build invalidated dist consumers; all recorded final
checks run after builds. No existing test expectations were weakened.

## Scale and bundle measurements

The shared synthetic scale fixture uses **3,500,000 input bytes**, exactly
**1,000,000 estimated input tokens** with simpleTokenEstimator and **1,000,028**
prepared tokens. The scripted provider request serializes to **3,500,419 bytes**.
This is not an exact model-token count or a live LLM performance benchmark.
Preparation-ready timing is elapsed time from run start to context:prepared,
including initial input setup, not an isolated profiler measurement.

The machine record retains per-engine page/Worker times and available memory.
Local runs are in tens of milliseconds with observable page-thread timer delay;
these results do not establish a universal one-million-token memory or latency
limit. Node heap readings include transient allocations; Chromium heap readings
are coarse. Worker heap readings and Firefox/WebKit page heap readings are not
available through this fixture. No invented memory estimates substitute for them.

The complete test consumer is about **11.1 MB raw / 3.1 MB gzip**. It includes SDKs,
compatible library exports and the shared regression/example code. Synchronous
provider construction retains multiple SDKs, and vendor logo helpers retain the
large simple-icons inventory. The dependency inventory excludes backend storage,
server document parsers and optional native harness SDKs. Asynchronous provider
loading and broader package splitting were explicitly outside this refactor.

## Documentation handoff and use

[Browser Agents](../BROWSER_AGENTS.md) is the integration recipe: same root API,
browser TypeScript conditions, Worker setup, custom factory/manual plugins,
contributor revisions/authority, register-before-load, host tools/auth/storage,
realm-local budgets, shutdown and uncertain-action recovery. README, User Guide,
AGENTS, context assembly, durable evidence, model-task guide, examples index,
AMOS guide, CHANGELOG and Version 2 availability now link or teach that contract.
API references are regenerated through the existing generator; its public header
also distinguishes compatible browser exports from host-only APIs.

Run npm run example:browser-node for the shared offline Node scenario. Install
Playwright development binaries, then npm run test:browser for the strict-CSP
three-engine matrix, npm run test:browser:types and npm run test:browser:package.
The latter supports ONERINGAI_NODE22 for an additional runtime. Proof reproduction
uses the isolated qualification fixture dependencies and Node 22 oracle.mjs;
run-browser.mjs consumes that oracle with the production schema adapter. Examples
close agents, tasks, Workers, browsers and the local gateway. Demo session/evidence
storage is memory-only, not a new persistence product.

Provider/gateway integration and consumer upgrades remain separate.
Browser lifecycle termination cannot guarantee completion or checkpoint delivery.

## Beta readiness corrections — 2026-11-08

The additional release review found an embedded MCP dependency missed by a clean
consumer-only audit, referenced annotation descendant handling, and anonymous-ID
cache differences. The fixes retain the existing Agent and plugin API:

- Build with MCP SDK 1.32.2 and compatible patched URI/Hono dependencies. Capture
  actual esbuild inputs and seal final artifact hashes; audit exact embedded package
  paths separately from installed external dependencies. Test the public packaged
  ESM/CJS MCP adapter for same-origin success and cross-origin header/body blocking.
- Index referenced annotation subtrees through the existing schema traversal,
  preserving lexical scope and native ID registration. Apply admission before I/O,
  preserve literal const/enum data and keep anonymous roots out of the ID cache.
- Add focused regression, cache/tamper/audit tests, a 150-case schema qualification
  corpus and public primary/local validation tests in all six browser realms.
  The broader 462-case schema/profile probe also matches the native compiler.

The [correction evidence](../evaluations/BETA_READINESS_FIXES_2026_11_08.json) records
the first correction package, browser, Node and AMOS gates. Earlier review observations
remain historical; the beta.2 record covers subsequent fixes and the authorized release.

The final beta.2 review additionally corrected trailing `#/` resource normalization,
all-keys metadata ID discovery, strict property/pattern and tuple admission, and
inactive branch handling. ID discovery uses the existing traversal independently
of active validation; generated AJV keyword metadata determines no-op branches.
Resolved targets remain stable when ignored collection keywords are removed.
The public primary/local-schema repro now matches Node in pages and Workers.
