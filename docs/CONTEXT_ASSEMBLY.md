# Selective context assembly and stable prompt layout

Current status (2026-10-22): **all first- and second-review corrections validated
on branch**. See [completion](designs/STAGE_05_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-22)
and [validation](evaluations/STAGE_05_SECOND_CORRECTIONS_VALIDATION.json): 8,340 units,
190 live tests / 202 scenarios across all three providers, 28 offline examples,
92 public controls and all local/AMOS/type/build gates pass. Historical review
and validation remain available. No package release is claimed.

Stage 05 is opt-in on the Version 2 branch; package release is separate. Existing
plugins, default Agent/context layout, observation hooks, tool execution, history,
compaction strategies and saved state retain their contracts. Selection is a prompt
view over sources, not a new memory backend, model router or retrieval service.

## Select without deleting sources

```typescript
import {
  AgentContextNextGen, createInContextMemoryContributor,
  type InContextMemoryPluginNextGen,
} from '@everworker/oneringai';

const context = AgentContextNextGen.create({
  model: 'gpt-4o-mini',
  maxContextTokens: 8000,
  responseReserve: 512,
  features: { workingMemory: false },
  assembly: {
    maxDataTokens: 512,
    sourceTokenLimits: { in_context_memory: 512 },
    layout: 'stable-prefix',
    reasoningReserveTokens: 256,
  },
});
try {
  const memory = context.getPlugin<InContextMemoryPluginNextGen>('in_context_memory')!;
  memory.set('receipt', 'Keep exact identity and uncertainty', { id: 'A42', status: 'completion-unknown' }, 'critical');
  memory.set('background', 'Retained source', 'background '.repeat(1500), 'low');
  context.registerContextContributor(memory.name, createInContextMemoryContributor(memory));
  context.addUserMessage('Inspect receipt A42.');
  const prepared = await context.prepare();
  console.log(prepared.budget, context.lastPreparation?.selection);
  // Both entries still exist. Inspect the manifest to see which entered this request.
  console.log(memory.getContents().size);
} finally {
  context.destroy();
}
```

For normal managed execution, pass these context options to `Agent.create` with a
named connector, then register the companion on `agent.context` between executions.
Call `run()` or `stream()` normally: they prepare and validate the submitted request.
Do not call prepare first in application code. Direct calls and external drivers
retain their existing ownership and do not implicitly run these contributors.
The runnable [selection example](../examples/context-block-selection.ts) compares
an overflowing legacy view with fitting selection using the same stored entries.

## Explicit companion registration

`registerContextContributor(pluginName, contributor)` requires an existing enabled
plugin. It replaces that plugin's `getContent` prompt view, leaving stored state,
tools and default instructions intact. `unregisterContextContributor(name)` returns
the source to its legacy content view; the opted-in assembler/layout remains enabled.
The optional `assembly.contributors` map performs the same registration at creation,
after plugins exist. Failed registration on a legacy context does not activate it.

A `ContextContributor` provides synchronous `getRevision()` and synchronous/async
`contribute(request)`. Revisions are finite numbers or strings and must change for
source content, scope, permission, applicability and host selection-policy changes.
Selection driven only by the packet input is tracked separately by the framework.
Revision getters must be synchronous and side-effect-free. Class methods
retain their receiver. The packet includes detached input, model, configured data
budget and a cancellation signal. It does not supply credentials or grant authority;
host-selected providers must read only sources authorized for the current host scope.
No similarly named method on an existing plugin is detected or invoked automatically.

Each returned `ContextBlock` has a local `id` and `text`. Optional fields are
`priority` (-1000 to 1000, default 0), `protected` (default false), `dependencies`
(fully qualified `plugin/id` strings), `expiresAt` (absolute timestamp) and
`projection` (a smaller host-supplied data view). IDs are nonempty, at most 256
characters and contain no control characters. Blocks cannot supply system roles,
authorization, tools, prompts or model configuration. They enter one JSON **user
data message**, never developer instructions. JSON encoding and role separation do
not establish semantic truth or eliminate prompt injection; tool permissions remain
independently enforced through the one shared ToolManager.

The companion may explicitly supply trusted host `instructions` (string or null)
to replace its plugin's usage instructions. Selected stores also receive partial-view
guidance in the unified overview and store_get description; their native schemas and
source returns are unchanged, and unregister restores legacy prompt guidance.
This field belongs to host registration,
not returned blocks/retrieved data. The built-in whiteboard adapter uses it to
explain partial visibility and exact `store_get` recovery. Never copy untrusted
source text into this host instruction field. Registered names `task_state`,
`evidence` and `persistent_instructions` cannot replace their protected legacy views.

## Budgets, dependencies and freshness

Selection uses estimated remaining model capacity after legacy instructions/data,
tools, known schemas/native definitions, conversation/current input and response
reserve. `maxDataTokens` (default 2048) includes the complete data-message wrapper;
`sourceTokenLimits` optionally limits each source, conservatively counting its own
wrapper. Deterministic priority and ID order choose optional blocks and complete
dependency closures. An optional block may use its explicit projection if its full
view does not fit. A dependency required by another selected block retains its full
view; projection of a stand-alone entry cannot silently stand in for that dependency.

Protected blocks and their dependencies retain full text. Missing/expired required
dependencies, cycles, duplicate IDs, malformed blocks or a protected closure exceeding
component/source limits fail explicitly. Optional expired/missing-dependency/budget
blocks are omitted with reasons. Protected data that only exceeds the remaining
global window participates in the existing bounded history compaction; final fit
still fails if necessary. Selection never edits source stores or journals. An existing
configured compactor can still compact its sources according to its contract.

Other limits: `timeoutMs` defaults to 1000 for cumulative contributor time across rebuilds
of one preparation and its optional final input refresh (excluding existing legacy hooks and compaction), maximum 30000; `maxBlocks` defaults to 128, maximum 2048;
`maxBlockCharacters` defaults to 65536 per text/projection, maximum 1000000.
`maxDataTokens`, each source cap and `reasoningReserveTokens` are safe nonnegative
integers up to 1000000. The extra reasoning reserve defaults to zero and supplements
existing `context.responseReserve`; it neither enables thinking nor changes provider
output parameters. Hosts must set headroom appropriate to their configured output/
reasoning limits. No usable window produces an explicit overflow, not silent loss.

An async contributor is awaited with cancellation/deadline handling. A late result
cannot commit after cancellation/destruction/timeout; the framework cannot prevent
arbitrary private callback side effects or preempt synchronous host JavaScript.
Legacy `onBeforePrepare` remains nonblocking and keeps its prior error handling.
Other legacy `getContent`/template hooks retain existing awaiting semantics; the new
deadline does not turn those older callbacks into a preemptible sandbox.

Revisions and scope are checked after awaiting, after compaction rebuild and at final
managed dispatch. Account scope includes ToolContext.accountId and connectorAccounts,
taskId and opaque registry instance identity, as well as principal, identities and
roles. Registry credentials/private state are never serialized; changes inside the
same custom registry instance must still advance the contributor's scoped revision.
Changed live host input, submitted model, scope, expired selected blocks or modified
selected prefix require preparation again. Synchronous budget
observers cannot invalidate admission. Perform contributor registration between
preparations. Errors use `CONTEXT_ASSEMBLY_INVALID`, `CONTEXT_ASSEMBLY_OVERFLOW`,
`CONTEXT_ASSEMBLY_TIMEOUT` or `CONTEXT_ASSEMBLY_STALE`; callback/cancellation errors
retain their original failures. Ordinary global fit uses existing ContextOverflowError.

Managed hooks/request listeners may edit the submitted history/current input while
preserving its trusted/selected prefix. The manager sanitizes that edited input and
performs at most one additional contribution/selection refresh in the remaining
preparation allowance. Hooks and compaction are not repeated. Fit, cancellation,
scope, revisions, expiry and concurrent request changes still reject before dispatch;
a failed refresh consumes the attempt. The final manifest/counts describe the
dispatched selection. Existing history ownership is unchanged: a hook's detached
request edits are not automatically written into the source conversation.
`validateRequestBudget` stays synchronous and cannot perform this refresh; standalone
context callers should set actual input and prepare it again after task edits.

Structured JSON formatting/repair reuses the frozen selected prefix and still
checks contributor revisions, original input, the current host prompt, original
history/input prefix, scope, protected task state and fit. A normal answer commit
may append assistant/opaque output; replacing earlier input or the host prompt
cannot silently reuse its old formatting frame. Pending host corrections are kept.
It does not rerun contributors/compaction or overwrite main-call diagnostics. It
formats the settled answer, rather than interpreting the normal history commit as
new input. For selected structured run(), formatting precedes post-cycle consolidation.
Selected structured suspension formats once before its session/correlation save and
suspended notification, so its checkpoint contains the formatted answer. Default
unconfigured ordering, streaming and async-continuation ownership are unchanged.
If formatting/cancellation fails before persistence, the accepted tool observation
remains in live context; explicitly checkpoint it before destroying the context.
Neither a model answer nor a failed save proves durability; never repeat an accepted
action to repair formatting or storage. Helpers/tasks retain their existing budgets.

## Layout, manifests and actual provider observations

`layout: 'legacy'` is the default for opted-in assembly. `stable-prefix` separates
host/plugin instructions from later legacy data/current date/time, and sorts selected
tool definitions by name without changing the ToolManager or caller definitions.
Legacy data keeps developer placement; new contributed data stays user data. Dynamic
instruction templates can still change the prefix. No automatic provider cache
creation, cache key, hit guarantee, or native compaction is added.

Before first preparation, `calculateBudget` estimates only already materializable legacy/layout content; it does not run new contributors, start their deadline or fetch their data. Use the managed prepare path for an actual selected request.
Post-cycle consolidation likewise counts persisted history and legacy views without
fetching another transient contribution outside its preparation lifetime.

`lastPreparation.selection` is detached metadata: each block's ID/source, selected/
projected/omitted status, reason, estimated tokens, dependencies and declared
protection; configured/selected data tokens, layout, reasoning reserve and a scoped
request fingerprint. It contains no block bodies or raw source revision values.
Opaque/multimodal uncertainty includes images/files inside function/custom result
arrays and opaque tool-call thought signatures, as well as existing message/opaque
state. AMOS breakdown displays an uncertainty notice without source bytes.
The fingerprint is a local diagnostic for the model, host identity, request and
schema/tool scope, **not** a provider cache key. No selected-view cache is reused
across tenants or tasks because no selected-view cache is implemented.

`selection.accounting` distinguishes local estimates from the last actual managed
provider response, including max-iteration and suspension wrap-up calls.
`providerInputTokens`, `inputTokenDelta`, `cachedInputTokens` and
`cacheCreationInputTokens` use normalized provider usage; missing fields are `null`,
and actual zero remains zero. These are last-request observations, not a stream's
aggregate usage. Auxiliary JSON repair preserves the main request diagnostic.
A new prepare clears observations. Capacity source is
host/provider/registry/fallback; unknown models retain the legacy fallback, which is
not a verified model capacity. `opaqueOrMultimodal` flags opaque/image/file content;
existing estimates are not tokenization guarantees or knowledge of encrypted state.
Optional `assembly.tokenEstimator` reuses the public `ITokenEstimator` contract for
an explicit model/provider-specific host tokenizer. Methods keep their receiver and
must be deterministic, side-effect-free and return nonnegative safe integers;
missing image estimation retains the existing conservative fallback. It affects
request/block/schema accounting, not provider usage or plugin-owned compaction
heuristics. No tokenizer package, network lookup or automatic estimator is added.
Schema/native definitions and final host edits still count toward fit. No automatic
estimator tuning or inference about cost savings is made from these observations.

## Persistence, AMOS and verification

Sources retain their existing save/load behavior. Contributor callbacks, policies,
selected views, signal/deadline state and observations are process-local and are
not restored as authority from session JSON. Reattach trusted companions after
recreating/loading plugins; source revisions must reflect restored data. Saved
configuration with no assembly options keeps its old behavior. Preserve host
connector/account and evidence/task ownership checks during recovery.

AMOS accepts optional JSON `contextAssembly` settings (no contributor callbacks).
Set `selectWhiteboard: true` to attach the built-in adapter to each new/resumed Agent.
`/context breakdown` shows selected/omitted/projected reasons and measured/unknown
provider-cache counters separately from local tool/memory caches. Configuration is
applied when the next Agent initializes; invalid startup leaves the existing runner
intact. Existing presets and scopes remain explicit and unchanged.

After building:

```bash
npm run example:context-selection
npm run example:context-dispatch-safety
npm run example:cache-aware-context
npm run example:amos-context-selection
npm run test:agentic:compat
# Billable, opt-in; all three .env keys required:
npm run test:context-assembly:live
# Optional two-call cache observation example, one chosen provider:
STAGE05_PROVIDER=openai npm run example:cache-aware-context -- --live
```

Offline examples perform no network/model calls, print their bounded diagnostics
and destroy resources; the AMOS example also removes its temporary directory. The
live gate uses local synthetic reads, both layouts/run/stream, edited-input refresh,
ordinary/stale JSON repair, wrap-up accounting and actual cache counter observations.
The dispatch safety example illustrates bounded hook edits, stale host-prompt repair
rejection and synthetic wrap-up accounting without keys. It requires correct source markers and tool execution, not
a cache hit; it supports no general quality/cost claim or real service writes.

## Composition with native history (Stage 16A)

Explicit native policy keeps contributor instructions and selected data freshly
assembled outside the replaced history prefix. Selection budgets start from the
provider-counted base frame and the final candidate is counted again. Contributor
revision, scope and final-frame guards still apply through asynchronous native work
and formatting/repair. Contributions remain a transient view; compaction does not
turn selected data into plugin storage or native source authority. Other strategies
and old contributor contracts remain unchanged. See
[Native Context Compaction](NATIVE_CONTEXT_COMPACTION.md).
