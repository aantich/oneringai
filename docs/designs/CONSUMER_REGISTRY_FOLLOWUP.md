# Consumer registry follow-up — validated evidence and current design

- Date: 2026-10-23. **Planning only; current plan revision 5 awaits approval.**
- Input: `/Users/aantich/dev/icos/docs/oneringai-agent-registry-followup.md`.
- Library: `version2` at `dff238759c41431bd24712d3b045dd38fc800b37`.
- Consumer pin in the report: `991a977b769eabe6c43ec8eff6d057b20f0663d9`
  (package label 1.1.8); backend `70fad29d`, desktop `33d70ade5`.
- Updates: [main plan](CONSUMER_EXECUTION_HARDENING.md),
  [proposed APIs](CONSUMER_COMPATIBLE_APIS.md),
  [Version 2 guide](../VERSION_2_GUIDE.md).
- Evidence: [revision-4 record](../evaluations/CONSUMER_REGISTRY_FOLLOWUP_2026_10_23.json).
  Earlier revision-2/3 evidence is historical and retains its original hashes.

The report identifies warranted upstream work. Strengthen existing C6 rather than
add a competing orchestration builder. Add three small independent C9 subtracks;
do not make them prerequisites for execution hardening. No runtime, app, dependency,
schema, deployment or release change is delivered by this document.

## Validated disposition

| Report claim | Pinned/current finding | Plan decision |
| --- | --- | --- |
| Orchestrator drops general Agent configuration | Confirmed on this branch as well. Parent/worker construction selects a small field set; a cast or read-only snapshot cannot fix it. | Strengthen C6 with complete configuration **before construction**, including initialization effects. |
| Root/worker context needs reserve, strategy, storage, timezone and plugins | Confirmed. Current orchestration has only selected features/plugins and manually attaches its workspace after construction. ICOS's shared context builder now forwards reserve/strategy even without memory. | C6 forwards complete context while preserving library-owned workspace/lifecycle; test real budgeting and plugin initialization. |
| Three reasoning-capable Realtime models lack effort metadata | Confirmed in current `MODEL_REGISTRY` and the consumer pin. The generic session effort union is not model-specific evidence. | C9-A publishes endpoint-specific companion capabilities. Verify each model separately; do not guess from the union. |
| Temperature is filtered then rejected against original options | Confirmed in pinned source. Current branch deliberately preserves GPT-6 family sampling options until effort-aware validation. Non-`none` effort rejection is intentional. | C9-B adds opt-in normalization, retains strict defaults and raw provider-control errors; no blanket removal of validation. |
| Generation/counting should use a shared decision | Partly implemented today: generation, streaming and batch validate; native input counting builds an input-bearing projection without that validator. A successful count cannot prove the generation request is valid. | C9-B assesses the effective selected request before endpoint projection, with endpoint-specific constraints and paired legacy tests. |
| Browser-safe IDs do not supply branding | Confirmed. `/shared` exports IDs/registries/service data, but no LLM display-name/color catalog. | C9-C adds pure presentation data; preserve auth/service classification and host overrides. |
| STT streaming implies conversation input transcription | Unsupported inference. Generic streaming metadata has no session-mode/transport-specific compatibility contract. | C9-A models these distinct surfaces explicitly before consumer filter/admission changes. |
| ICOS vendor/temperature/context/email/VAD fixes and 24 tests | Reported consumer-owned fixes. Read-only spot checks confirm current temperature helper, context mapping, authorized child resolution and restored palette. The application test/typecheck totals were not rerun here. | Preserve these owners and mappings; later app PRs adopt selected SDK contracts. Do not count reported 24 tests or 24 existing diagnostics as library validation. |

The report's instruction to leave OneRingAI unchanged describes its ICOS task.
The current user explicitly requested library **plan adjustments**. No runtime
implementation, app edits or SDK pin upgrade follows from that request.

## C6: complete configuration before construction

### Correct the proposed extension point

Revision 3 proposed returning an already built Agent and attaching orchestration
integration afterward. That cannot reliably configure creation-time plugins/tools,
session behavior or lifecycle hooks. Replace that unimplemented proposal with one
configuration factory shared by parent and workers:

```typescript
// Proposed API, not a current package export.
const parent = await createOrchestratorWithFactory(orchestration, {
  configureAgent: async request => ({
    ...request.baseline,
    ...await resolveAuthorizedConfig(request.role, request.type),
  }),
  onChildOutcome: observation => recordChildObservation(observation),
});
```

`configureAgent` receives role, allocated name, optional worker type and detached
baseline configuration. It returns a complete `OrchestratedAgentConfig` or promise.
It is host code; the model cannot choose a user, tenant or authorization scope.
The library composes required tools/workspace and constructs once using the
existing Agent/context/ToolManager engine, before initialization hooks can observe
the instance. Implement the smallest private assembly seam needed; do not create
a second public plugin system or replace ordinary Agent construction.

`OrchestratedAgentConfig` reuses AgentConfig except library-owned `name` and
`parentAgentId`, prebuilt `context`, and `toolManager`. It accepts a plain
`AgentContextNextGenConfig`. This restriction applies only to the **new** entry
point. Existing supported constructors/instances/callbacks remain unchanged.
Plain configuration permits creation-time composition and exclusive ownership;
supporting borrowed live instances would require a separate lifecycle contract
without helping the reported saved-configuration use case.

### Configuration and precedence contract

The normative field/precedence/ownership table lives in
[API configuration ownership](CONSUMER_COMPATIBLE_APIS.md#configuration-ownership).
It covers all forwarded fields, top-level versus context identity, ordinary
session/timeout precedence, explicit root/worker fallbacks and shared-board visibility.
This evidence document explains why C6 is needed; it does not maintain a second
copy of the contract. The host returns complete configuration without a hidden
merge. Existing APIs remain unchanged.

### Ownership and validation gates

- Validate shape, connector access, reserved-name conflicts and ownership before
  construction/model calls. Detach mutable containers without cloning live handles
  or callbacks. Do not mutate the host's saved configuration.
- Agents/contexts created by the library belong to this orchestrator. The host
  retains connectors, backend handles and borrowed tasks; cleanup must not destroy
  them. A pending asynchronous callback cannot install a worker after teardown or
  exceed the reserved worker capacity. Initialization failure rolls back newly
  acquired resources without destroying the board or other workers.
- Retain C2/C6 per-operation accounting, child cancellation, quarantine and late
  delivery rules. Full configuration does not establish verified completion or
  duplicate-effect prevention.
- Paired old/new tests cover every field above, actual mocked provider request
  bodies for root/workers on different vendors/accounts, initialization-time
  plugin/tools/hooks, storage, no-memory reserve/strategy, collision/permission
  isolation, cancellation and cleanup. Include empty/zero/false and omitted values.
  A snapshot-only forwarding test is insufficient.
- Ship an offline example with different root/worker inference/context settings
  and narrow authority, assert observed requests, and clean up. Update AMOS if its
  orchestration surface exposes these controls; otherwise record non-applicability.

Later ICOS adoption passes the existing prepared root config at
`createAgentWithHooks` and each authorized/effective worker config resolved through
`resolveOrchestratorChildAgents`. Reuse current tool, context and authorization
owners. Measure context-preparation reads before expanding the path. A normal
immutable dependency-pin upgrade and separate consumer tests/PRs are required;
casts, private mutation, copied runtime code, new caches and schema changes are
not workarounds in this plan.

## Independent C9 subtracks

Each is separately selectable and uses the existing per-slice test/example/AMOS/
documentation gates. Freeze exact new names/signatures at its stage-entry API
review. Descriptive helper names below are design candidates, not exported APIs.
None requires C1–C8 completion; none automatically changes old callers.

### C9-A — Endpoint-specific Realtime and transcription capabilities

Provide a small browser-safe **companion capability resolver**, keyed by existing
model IDs and the actual endpoint/session mode/transport. Reuse the authoritative
SDK registry identity; do not duplicate model prices, limits, defaults or the full
model table. Candidate queries are `getRealtimeModelCapabilities(model)` and an
input-transcription support query over conversation model, transcription model and
WebSocket/WebRTC transport. Both are side-effect-free data lookups.

Represent supported, explicitly unsupported and **unknown** separately. Reasoning
records contain verified per-model allowed efforts, source/probe provenance and
verification date. Transcription records distinguish file transcription, dedicated
transcription sessions and conversation input-transcription configuration. Attach
transport/session constraints to the relevant pair, not a generic `streaming` flag.
No network request occurs during import, lookup or form rendering.

Keep the companion sparse: only verified endpoint/transport constraints belong in
it, with unknown for unlisted combinations. Do not precompute a Cartesian product
of every voice/STT model or invent a generic capability-rule language. Where facts
already exist in SDK model data, project them rather than re-entering them. Source
citations/verification dates can be maintained with the data; no runtime research
service, automatic probes or documentation parser belongs in the package.

Provider verification as of this review:

- The official voice prompting guide explicitly lists `minimal`, `low`, `medium`,
  `high`, `xhigh` for **gpt-realtime-2**.
  [OpenAI reasoning effort guidance](https://developers.openai.com/api/docs/guides/voice-prompting#set-reasoning-effort).
- Model pages establish reasoning capability for **gpt-realtime-2.1** and
  **gpt-realtime-2.1-mini**, but the fetched pages do not enumerate their exact
  allowed effort sets. Do not extrapolate the 2 set or the SDK's generic union.
  [2.1 model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1),
  [2.1-mini model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini).
- Dedicated transcription sessions and conversation sessions are distinct.
  `gpt-transcribe` committed-turn Realtime input transcription is documented for
  WebSocket; `gpt-live-transcribe` streaming transcription has different VAD
  constraints. These facts do not establish every conversation-model/transport
  pairing. [OpenAI transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription).

At implementation, reverify official contracts; where exact support is missing,
use an explicitly authorized bounded read-only provider probe or retain unknown.
Never claim all three requested models are verified if any remains unknown. A
selected delivery may publish verified entries with explicit coverage exclusions;
the outstanding entries remain open, not silently passed. No invented model list,
default effort, new model admission or automatic change to saved settings.

For this compatibility-first work, legacy raw registry records/getters, generic
session unions, old validation and STT streaming behavior remain unchanged. Add the
companion on `/shared` and appropriate public exports; adopted consumers explicitly
choose it. This requires a small ICOS selector integration in addition to upgrading
pins, rather than promising a pin alone will change choices while freezing legacy
registry behavior. Keep saved existing efforts visible and unknown distinct from
unsupported. Stronger session rejection requires its own explicit opt-in contract.

**Acceptance:** exact documented model-specific effort sets; no missing metadata
silently interpreted as unsupported; unknown/custom endpoints; saved legacy values;
WebSocket/WebRTC and session-mode matrix; negative unsupported combinations where
verified; unchanged legacy JSON/validation. Test browser bundling with no Node or
provider SDK imports. An offline capability-inspection example covers all states;
opt-in live probes validate only selected entries and record exact model/transport.
AMOS changes only if it exposes Realtime settings; do not add a new voice UI just
to demonstrate metadata.

### C9-B — Shared assessment and opt-in temperature normalization

Preserve the current strict default. The current OpenAI generation/streaming/batch
validator intentionally rejects sampling when effective reasoning is active.
The Responses WebSocket surface also calls the shared validator.
Sol/Luna `none` differs from Astra/6.1 Sol; static model-level temperature flags
alone are insufficient. The official parameter guidance supports these conditional
restrictions. [OpenAI current parameter guidance](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-update-api-and-model-parameters).

Design one pure public parameter-assessment contract using named vendor, actual
model/endpoint and **effective** reasoning after defaults/overrides. An opt-in
normalizer can omit explicitly unsupported **neutral temperature**, with bounded
diagnostics explaining the decision. Preserve supported/unknown values, zero and
absence; never mutate saved configuration or infer vendor from model text.
Keep explicit raw `vendorOptions` controls distinguishable: unsupported explicit
provider controls continue to fail validation. Do not generalize this into a
silent sanitizer for arbitrary malformed requests or all generation parameters.

Stage-entry API design must include application of this policy to the actual
selected request, not only a convenience form helper. Managed routing/fallback and
per-call overrides can change model/effort after construction. Selected generation,
streaming, native counting and batch paths assess the same effective request before
endpoint-specific projection; count requests need not send generation-only fields.
Audit Responses WebSocket/direct surfaces separately and state their actual
support. Counting success does not certify all dispatch, auth or input-capacity
constraints. Old default count behavior is frozen; selected-path consistency must
not silently add rejection to a legacy count call.

Use existing provider validators/builders; do not create another router/provider
layer. Reuse one private effective-parameter assessment primitive for existing
validation facts and the selected assessment/normalization projection; do not copy
model-family conditions into a second helper table. Keep the legacy validation
adapter's exact errors/default behavior frozen. Narrow this first policy to neutral
temperature rather than building a public rule registry or generic sanitizer.
Freeze exact opt-in API and enforcement placement before implementation.
If a proposed configuration option cannot preserve strict legacy behavior, revise
that proposal rather than weakening old validation. Keep the ICOS guard until the
new contract is delivered **and adopted**. Its static helper may conservatively
omit a conditionally supported value; document this limitation without removing
the working consumer safeguard prematurely.

**Acceptance:** paired legacy strict and selected normalized request tests for
generation, stream, native count and batch; all affected model/effort combinations;
defaults, zero/absence/unknown models; neutral versus explicit raw controls;
per-call precedence, route fallback, immutable saved input and mocked request
bodies. Unsupported combinations must fail before dispatch on the selected strict
path. Ship an offline request-decision example and opt-in read-only transport
smoke tests where justified. AMOS may show the explicit policy/diagnostic if adopted;
its existing default behavior stays unchanged.

### C9-C — Browser-safe vendor presentation

Publish an optional pure-data catalog with vendor ID, display name and CSS-ready
color, plus a bounded lookup. Reuse `Vendor` IDs; preserve existing `Vendor`,
`VENDORS`, `isVendor`, service-template classification and auth behavior. SDK
`Vendor.Custom` denotes an OpenAI-compatible endpoint; ICOS generic `custom`
services must not become LLM/platform-managed identities through this catalog.

ICOS's existing display palette is consumer presentation, not proof of official
immutable brand specifications. Agree the initial labels/colors during API review;
host applications compose their own presentation overrides without an SDK override
registry or theme engine. Existing
ICOS adoption preserves its approved labels/colors rather than replacing them
with enum names or uniform gray. Unknown IDs remain explicitly unknown so the host
chooses a fallback. No logo downloads, runtime fetches, Node imports, model defaults,
provider detection, new authentication or eager production dependencies.

**Acceptance:** known IDs covered, valid CSS colors, distinct identity/presentation,
unknown behavior, immutable data, ESM/CJS and browser-safe `/shared` export tests;
legacy vendor/service/auth fixtures unchanged. Ship a small offline catalog example.
AMOS may consume names/colors if it has a vendor picker; no UI expansion is required.
ICOS replaces its map only after testing presentation parity and custom-service
ownership under the normal dependency upgrade.

## Adoption, sequencing and documentation

Keep C1 → C2/C3 → C4 → C5 → C6 → C7 → C8 as the recommended execution sequence,
with existing independent C6/C7 dependencies and C8 tests growing throughout.
C9 subtracks may be selected independently for immediate consumer value; they do
not justify bundling registry rewrites into C6. C9-A reasoning/transcription can
have separate evidence gates without two competing capability frameworks.

Every selected slice needs the same extensive regression/failure/compatibility
tests, examples and relevant AMOS coverage as the core roadmap. Freeze the exact
consumer pin and current-branch legacy fixtures. Before completion, update
Version 2 availability/adoption/handoff plus affected standard guides/examples/
release notes; regenerate API docs only when the API is implemented. Distinguish
branch-delivered code from a verified immutable release and from app adoption.

Consumer-owned fixes remain consumer-owned: VAD clearing, email sender isolation
and reply protocol, generic custom-service ownership, saved configuration mapping
and presentation must not regress during adoption. No new database/index/cache,
external writes, consumer rollout or production backend belongs to this follow-up.

Approval selects the revised direction and gates, not implementation of every
slice. No breaking change, automatic migration, default flip, Stage 14B/16B or
package publication is included. Revision 3's factory was only a proposal; changing
it now does not change a supported public API.

## Historical revision-4 follow-up validation

Fresh existing tests pass **196 tests across nine files**, with zero failed or
skipped tests. They cover orchestration construction, OpenAI generation/streaming,
advanced provider APIs, Responses WebSocket, Realtime, STT, model metadata and vendor completeness.
**202 public ESM/CJS compatibility controls**, the legacy built-package TypeScript
consumer and the updated strict compile-only proposal pass. The proposal includes
**12 negative type controls**, including built-Agent/live-context/shared-manager
rejection only on the new orchestration path; it is not a runtime implementation.

The [offline diagnostic fixture](../evaluations/consumer-registry-followup-probes.mjs)
matches **seven asserted observations**: missing effort lists, unchanged vendor
identity, generic STT streaming, strict temperature rejection, conditional zero
sampling, count/generation divergence and explicit raw control rejection. It uses
mocked transport and blocks network. Expected errors in that fixture are assertions
of current behavior, not failing tests or fixed runtime defects.

The machine record includes exact commands, input/source/document hashes, pinned
source comparison, official documentation references and remaining uncertainties.
All 63 runtime hashes from the prior Stage 14A corrective record still match.
Local documentation links/anchors and tracked/untracked whitespace are checked.
No `.env` reads, real model/provider calls, external writes, ICOS tests/edits,
full-unit/live rerun, dependency changes or package release occurred. Previous
334-test/revision-3 and Stage 14A full/live totals remain historical, not added to
these fresh checks. No proposed C6/C9 behavior is claimed implemented or tested.

## Revision-5 review boundary

The [final simplicity review](CONSUMER_PLAN_FINAL_SIMPLICITY_REVIEW.md) corrects
registration/catalog assumptions, configuration ownership, continuation admission,
report duplication and direct-call cancellation reuse. It is the current review;
its machine record owns revision-5 documents/type controls and fresh checks.
The revision-4 validation above and its hashes remain historical, not rerun totals.
No implementation, application upgrade or default change is delivered here.

C6 delivery update: complete construction and per-operation lifetime are
[implemented and validated](CONSUMER_C6_DELIVERY.md). The research statements
above describe the original review, not current availability. C9 companions and
parameter/presentation work remain pending under the authorized sequence.
