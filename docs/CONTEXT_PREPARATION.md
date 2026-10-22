# Context preparation and freshness

Stage 01 of the Version 2 roadmap is available in the `version2` working tree.
This document describes the delivered behavior, not a released npm version.

Managed `Agent.run()` and `Agent.stream()` select a prepared request immediately
before each model call. Compaction can change the working-memory index, catalog,
instructions, history, and enabled schemas. Preparation now renders and counts
those contributions again after compaction, sanitizes protocol blocks before
counting, and checks the final estimated request against the configured window.

## Using the library

The working-memory index contains keys and descriptions, not stored values.
`store_get({ store: "notes" })` returns that metadata index. To read a source,
pass its exact key, including any tier prefix and collision suffix:

```typescript
const source = await agent.tools.execute('store_get', {
  store: 'notes',
  key: 'raw.tool_result.read_source.12345678.function.1',
});
// Found entries expose their original value in source.entry.value.
```

Use `store_list({ store: "notes" })` to discover entries omitted from the visible
index. Read each required source by key before answering from its contents. A
successful metadata-only lookup does not establish that the source was read.
Key remains optional, keyless return shapes are unchanged, and other stores retain
their own keyless behavior. The notes prompt uses unified `store_*` guidance;
the older WorkingMemory formatter keeps its existing legacy tool guidance.

Existing managed agents need no configuration changes. They continue to share one
tool manager with their context. Algorithmic compaction remains the default,
and the existing critical trigger remains `0.9` of the content capacity after
response reserve and tool definitions. A strategy's `threshold` controls the
reclaim target, not the trigger: the target is the smaller of
`strategy.threshold - 0.1` and `criticalCompactionThreshold - 0.1`.

Preparation calls a strategy at most once. It rebuilds afterward and either
returns a fitting estimate or throws `ContextOverflowError` (`CONTEXT_OVERFLOW`).
The reclaim target is not a mandatory postcondition: protected content can leave
a fitting request above the critical threshold. Preparation does not repeatedly
invoke a strategy until it reaches a desired percentage.

For inspection, use the new additive diagnostic getter:

```typescript
const selected = agent.context.lastPreparation;
if (selected) {
  console.log(selected.revision, selected.preparedAt);
  console.log(selected.budget.totalUsed, selected.budget.available);
}
```

`revision` increases on successful preparation. `preparedAt` is a millisecond
timestamp. The getter returns a detached diagnostic snapshot. It is `null` before
the first successful preparation. Counts describe the last selected request;
later messages, consolidation, or rollover do not turn that snapshot into a
measurement of current mutable state. Revisions are process-local diagnostics,
not session format versions or durable execution IDs.

`lastBudget` and `calculateBudget()` retain their existing cached-budget behavior.
Before the first preparation, `calculateBudget()` returns a fresh estimate without
compacting. Do not call `prepare()` just to refresh a UI: it can compact and
select another revision.

## Low-level adapters

The existing no-argument `prepare()` call remains supported. An adapter that sends
additional instructions or filters tool visibility can supply those contributions:

```typescript
const prepared = await context.prepare({
  instructions: extraInstructions,
  getTools: () => visibleDefinitions,
});

const request = {
  model: context.model,
  input: prepared.input,
  instructions: extraInstructions,
  tools: prepared.tools,
};

// Run all synchronous host hooks/request listeners first, then capture the
// request fields and recount immediately before dispatch.
context.validateRequestBudget(request);
```

`ContextPrepareOptions`, `ContextPreparation`, and the optional
`PreparedContext.tools` field are exported from the package root. `getTools` is
synchronous and can be called again after compaction. It must return the actual
visible definitions, including current dynamic descriptions. It must not mutate
the conversation. Without it, context preparation reads enabled definitions from
the shared tool manager and evaluates their description factories.

Managed Agent execution supplies its identity-filtered definitions, preserves
separate top-level instructions, and dispatches a detached schema/input snapshot.
It resolves the initially selected provider's usable capacity and known structured
output/native-tool contributions before deciding whether to compact. Native,
prompt, or deferred JSON enforcement is selected using the current visible tools
and selected again if compaction changes those tools. Old evictable history can
therefore be reclaimed for a schema that was already supplied in `run()` options.
It checks hook and synchronous `llm:request` listener changes before dispatch,
then captures counted fields before `budget:updated` listeners can reenter host
code. Fitting replacements retain their existing behavior. An oversized
replacement fails before dispatch and reports `llm:error` for that request.
Streaming keeps its existing request-event shape and hook return semantics;
in-place changes through retained streaming hook references are checked too.
`validateRequestBudget()` sanitizes message protocol blocks, updates the diagnostic
budget for the same prepared revision, and emits `budget:updated` if its counts
change. Existing run/stream hook dispatch semantics are preserved; this stage does
not change which streaming hook return values the existing loop applies. A final
check does not invoke preparation, compaction, or observational hooks again.

The optional request `model` selects registered capacity. Managed Agent execution
supplies the actual provider's `maxInputTokens` or `maxTokens` metadata, including
custom models. Ordinary custom-provider calls retain registry/host fallbacks when
metadata lookup throws or supplies invalid capacities. An explicit host
`maxContextTokens` remains an upper bound. An
inferred window may follow a larger or smaller per-call model without changing
the owning agent/context model or its configured window. Unknown models retain
the existing fallback when no usable capacity is provided. Initial preparation
uses usable provider metadata for the owning model, with registry/host fallbacks;
selecting a larger model in a later hook
does not rerun that preparation.

Low-level adapters may supply `modelMaxContextTokens` and a synchronous
`getRequestOptions(tools)` callback on `ContextPrepareOptions`. The callback
returns provider-contract `instructions`, `response_format`, and/or `native_tools`;
omitted fields need no contribution. `instructions` remains supported as a static
option; a callback's supplied instruction value overrides it. The callback must
not mutate context or tools. It can run again after compaction, so resolve any
tool-dependent enforcement there rather than caching the original tool inventory.
Pass the same contributions and capacity into dispatch/final validation:

```typescript
const requestOptions = {
  instructions: extraInstructions,
  response_format: { type: 'json_object' as const },
};
// Example adapter metadata: the initially selected provider advertises 8,192 tokens.
const modelMaxContextTokens = 8192;
const prepared = await context.prepare({
  getTools: () => visibleDefinitions,
  getRequestOptions: () => requestOptions,
  modelMaxContextTokens,
});
const request = {
  model: context.model,
  input: prepared.input,
  tools: prepared.tools,
  ...requestOptions,
};
context.validateRequestBudget(request, { modelMaxContextTokens });
```

These options are additive. No-argument preparation and existing static
instruction/tool callbacks retain their behavior. Invalid/throwing provider
metadata uses existing fallbacks, and explicit host limits remain upper bounds.
The provider window used for a request does not replace durable owner configuration.

`validateRequestBudget(request, { modelMaxContextTokens, recordPreparation })`
accepts optional provider capacity and diagnostic policy. The default records
the final managed budget on the same revision. `recordPreparation: false` checks
an auxiliary request without changing history, input, caches, revisions, or
diagnostics. Both policies count supplied structured schemas and native-tool
definitions. Managed JSON formatting/repair uses this auxiliary policy before
its provider call, preserving normal parsed output, history replacement, and
combined usage for fitting repairs. A repair that cannot fit raises
`ContextOverflowError` before an additional provider call.

These checks do not change `runDirect()`/`streamDirect()` into managed execution.

## Protocol groups and active work

A single assistant message may contain several calls whose results occupy
different messages. Compaction removes the entire connected message group.
Function and custom calls use separate ID namespaces. Native function/custom
continuation outputs participate in groups when their call is present; outputs
whose call lives in provider-managed continuation state remain opaque and intact.

Algorithmic spill inventories message and native function/custom outputs before
removing their connected group. It stores every result, including small connected
results, native multimodal arrays, message `__images` attachments, and errors.
Ordinary stored values and their existing keys retain their representation; a
message result with attachments/error uses a value containing `content`,
`__images` and/or `error`. Key allocation checks existing raw memory entries as
well as the current inventory, including after save/load. A colliding generated
key receives a namespace suffix;
the working-memory index exposes the actual key. Removal logs count actual items.
All spilled values must still match the intended values after the writes. A failed write or
evicted spill leaves history intact, although earlier memory writes may remain.
Retries can leave an additional copy of a prior partial spill; they do not overwrite
it. Existing memory capacity/eviction policy still applies, and this is not a
transaction against concurrent external writes to the same backend.
Groups whose result cannot be serialized are retained. A still-oversized retained
group fails the normal fit check. This is a safeguard for spill, not a durable
storage acknowledgment or a change to ordinary rolling-window retention.

Groups needed by current input are protected. A native call marked `async: true`
can remain unresolved across later model requests and is also protected until its
final output arrives. The provider protocol flag is distinct from the library's
`blocking: false` tool execution mode.

The supported update patterns include replacing an existing observation before
preparation and the library's asynchronous completion messages. Two distinct calls
are not the same as two final results for one call. Duplicate final results or
duplicate call IDs within one namespace now report `AIError` with
`INVALID_TOOL_PROTOCOL`; they are not silently treated as parallel calls.
Unmatched synchronous message blocks are pruned from the selected request without
rewriting persisted history. The budget counts the pruned request.

These rules follow the actual continuation contracts in the
[OpenAI function-calling guide](https://developers.openai.com/api/docs/guides/function-calling),
[OpenAI async guide](https://developers.openai.com/api/docs/guides/async-tool-calling),
and [Anthropic tool-call guide](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).
Provider-specific ordering, hosted-tool state, and capability validation remain
the provider adapter's responsibility; preparation does not reorder conversation
messages or reinterpret server-owned payloads.

## Bounds, races, and failures

Observational `onBeforePrepare` hooks still run once per preparation and remain
nonblocking. Synchronous throws and asynchronous rejections are logged without
failing preparation. Prompt-producing `getContent()` contributions are awaited
before obtaining the current instruction text, store overview, and tool schemas.
The context estimates the strings it rendered instead of relying on stale plugin
content/instruction token caches.

A host observation arriving during asynchronous rendering causes one rebuild.
Continued churn produces a clear retry error after two rendering attempts.
Concurrent preparation, consolidation, and rollover are rejected. During
compaction, controlled index removals and plugin compaction reject a stale
conversation/input/system/model snapshot. Host observations survive that rejection.
Existing rollover mutation checks remain in place.

Legacy `ICompactionStrategy` and `IContextPluginNextGen` implementations keep their
interfaces. Strategies see a freshly assembled pre-compaction budget even on the
first call. `removeMessages()` expands proposals to safe protocol groups and can
return zero for protected groups. Built-in strategies skip those groups before
estimating savings. Post-cycle consolidation uses fresh counts and the same critical
gate, with the last preparation's tool visibility and separate instructions.

The legacy extension path does not provide rollback of arbitrary plugin/backend
side effects or an atomic transaction across stores. A failed strategy may already
have written to working memory. Hosts should retry from stable context after
examining the error; they should not assume all plugin state reverted.

The oversized-input policy is preserved: an oversized user message is rejected;
oversized tool text may undergo the existing emergency truncation. Its allowance
now retains dependencies of pending results. Images and other protected content
are preserved, and a still-oversized request fails explicitly. A valid current
input is not truncated simply to reach the reclaim target.

## Estimates and limitations

Counts use the existing character-based estimator, message/tool overhead estimates,
and image estimates. They are not provider-reported usage or exact tokenization.
Native image output is counted as image content rather than base64 text; replay
signatures and known opaque input state are included.

Function/custom result accounting includes error text, including the empty-content
function failure that Anthropic renders from its `error` field. Error bytes and
attachments are preserved; an error that still cannot fit fails before dispatch.
No tokenizer approximation is used to justify omitting a known payload field.

A remotely stored file's ID
can be counted locally, but the provider-resolved file contents cannot. Provider
wire overhead, native hosted-tool expansion, and other hidden service state can
also differ from this estimate. Keep an appropriate response reserve and handle
provider context-limit errors.

Function-call `thoughtSignature` and thinking-block `signature` use the same
conservative text estimator. Their bytes and protocol placement survive replay
and persistence. Counting encrypted metadata this way is a local safety policy;
it does not assert that the provider tokenizes or bills those bytes as text.

This stage does not add helper models, summaries, retrieval policies, durable
evidence acknowledgments, or new compaction defaults. Those remain separate stages.

## Examples, AMOS, and validation

The 2026-10-08 [corrective validation record](./evaluations/STAGE_01_CORRECTIONS_VALIDATION.json)
retains 38 new regressions, the full 6,863-test suite, 10 live correction cases and
24 live baseline scenarios. It includes the initial oversized-retrieval fixture
failure and the corrected fixture, plus controlled JSON repair and real Google
signature replay. Earlier Stage 01 measurements remain historical evidence.

After building the library:

```bash
npm run example:context-freshness
npm run example:structured-budget
npm run example:amos-context
```

The first offline example forces a small window, shows the working-memory index
before/after spill, retrieves the small native result connected to a larger
message result, verifies a pending result retains its call, and prints the final
budget. The structured-budget example uses an injected offline provider to show
a fitting repair and an oversized repair stopped before its second call, with
cleanup of the agent and connector. The AMOS demonstration renders the real
`/context budget` and `/context breakdown` commands before and after preparation.
All three require no keys.

AMOS now labels the last prepared revision and estimated counts. Its breakdown
includes system overhead so components sum to the displayed total. The existing
overview command and subcommand names remain unchanged.

The separately opt-in `npm run test:context:live` uses `.env` credentials and makes
billable calls through named connectors on OpenAI, Anthropic, and Google. It tests
both managed `run()` and `stream()`, forcing an algorithmic spill and requiring a
real `store_get` call and correct recovered source marker. A successful call alone
does not satisfy the completion assertion. See the
[Stage 01 live record](./evaluations/STAGE_01_LIVE_VALIDATION.json) and
[offline AMOS transcript](./evaluations/STAGE_01_AMOS_OFFLINE.txt).

The delivery record and final check results are in the
[architecture roadmap](./designs/AGENTIC_ARCHITECTURE_EVOLUTION.md) and
[Version 2 guide](./VERSION_2_GUIDE.md).


## Opt-in evidence protection (Stage 03)

With the evidence plugin enabled, raw results whose evidence write was not
acknowledged carry optional version-1 persistence metadata. Their connected
call/result groups are excluded from compaction and scratch spill; emergency
truncation and semantic rollover cannot discard them. A fitting request can retain
raw results. Otherwise dispatch fails explicitly, preserving the source instead
of inventing a projection. Host-only `acknowledgeToolEvidence()` can release a
matching invocation after its retained result is stored, without rerunning the
action. Native async delivery stops on failed storage before flattening the result
into an unprotected text message. Existing sessions/configurations have no such
metadata and retain their existing behavior. See [durable evidence](./DURABLE_EVIDENCE.md).

## Opt-in transactional strategies

Stage 07 adds `observation-masking` and `structured-summary` registrations to the
existing single pre-call compaction pass. They require evidence retention and
preserve exact user/action metadata, pending dependencies and opaque state. Sources
are acknowledged and rechecked before applying a revision-guarded proposal. The
request is then rebuilt and recounted; no-op/fallback cannot bypass the final fit
check. A valid partial reduction can remain on a later fit error. Neither strategy
runs post-cycle compaction or calls explicit rollover mid-execution.

`ContextPrepareOptions` optionally accepts `signal` and a host-owned `summarize`
callback; Agent binds its configured compactor using the active ModelTask.
`ContextPreparation.compaction` and `CompactionResult.report` are optional
observability additions; `CompactionContext.compactConversation` is an optional
capability, preserving older extension contracts. See
[Context Strategies](CONTEXT_STRATEGIES.md) for defaults, schema/source checks,
experimental support, fallback, helper accounting and examples.


Opt-in Stage 05 [context assembly](CONTEXT_ASSEMBLY.md) adds explicit selectable data
views and stable-prefix layout while retaining this preparation/one-pass/final-fit
contract. New data, dependencies, expiry and source revisions have additional final
checks; default plugins and observation hooks are unchanged. JSON formatting/repair
retains its frozen selected prefix and actual main-call diagnostics without another
compaction. Inspect lastPreparation.selection for local estimates and normalized
provider-input/cache observations; no provider cache key or hit is inferred.

Managed history/input edits from hooks can trigger one final contribution refresh
within the original preparation allowance. Hooks and compaction are not repeated;
the request and its scope must remain stable during the refresh. Standalone
synchronous validation rejects a changed task until it is prepared again. Repair
retains its source frame only while the host prompt and earlier input remain valid;
ordinary answer commits are allowed. Post-cycle consolidation does not fetch another
transient contribution. Source stores, frozen/class-backed store schemas and saved
session formats keep their existing contracts. Selected structured run() formats
before post-cycle consolidation; selected structured suspension formats before
its session/correlation save. This preserves the admitted frame without weakening
current host/scope guards. On formatting/storage failure, checkpoint retained
accepted observations before destruction; never repeat their actions for recovery.
