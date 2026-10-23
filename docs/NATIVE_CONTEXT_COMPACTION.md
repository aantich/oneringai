# Plugin and provider-native context compaction

Stage 16A adds an optional composition strategy to managed `Agent.run()` and
`stream()`. Algorithmic remains the default. Existing strategy names, custom
instances, plugins, ToolManager, events and version-1 sessions keep their existing
contracts. Branch availability is recorded in [Version 2](VERSION_2_GUIDE.md);
it is not evidence of a published package release.

## Choose plugin and history behavior independently

```typescript
import { Agent, Connector, ContextCompactionStrategy, Vendor } from '@everworker/oneringai';

Connector.create({
  name: 'main',
  vendor: Vendor.OpenAI,
  auth: { type: 'api_key', apiKey: process.env.OPENAI_API_KEY! },
});

const agent = Agent.create({
  connector: 'main',
  model: 'gpt-6-astra',
  userId: 'trusted-host-owner',
  context: {
    model: 'gpt-6-astra',
    features: { workingMemory: true, inContextMemory: true, evidence: true },
    compactionStrategy: new ContextCompactionStrategy({
      plugins: 'auto',
      history: 'native',
    }),
  },
});

try {
  const response = await agent.run('Continue the current task.');
  console.log(response.output_text);
} finally {
  agent.destroy();
  Connector.remove('main');
}
```

Both controls are required on the new class. `automatic` defaults to `true`.

| `plugins` | `history` | Behavior |
| --- | --- | --- |
| `auto` | `off` | Eligible plugins reduce their own content under pressure. No native adapter/evidence prerequisite. |
| `off` | `native` | Plugins still render normally; only eligible older history can be replaced by native state. |
| `auto` | `native` | Reduce eligible plugins once, rebuild/count, then compact history if pressure remains. |
| `off` | `off` | Keep both bodies intact; preparation still validates fit. |

`plugins: 'off'` does not disable features, tools, persistence or rendering.
Enable plugins through the existing `features`/`plugins` configuration. A plugin's
existing `isCompactable()`/`compact()` contract determines whether it can shrink.
Evidence and protected task state are never included in that reduction phase.
The built-in in-context memory and working-memory plugins run before other
eligible plugins. A custom plugin need not implement any new methods.

The new class uses the existing `compactionStrategy` instance extension point.
It is not registered under a new strategy name; do not use
`strategy: 'context-compaction'`, `strategy: 'native'`, or
`NativeCompactionStrategy` in library configuration. Existing instance-over-name
precedence remains intact. AMOS has its own persisted composition setting.

## Automatic and explicit operations

Automatic work runs only at the existing bounded preparation boundary, using
`criticalCompactionThreshold`. Each eligible plugin is called at most once; at
most one native operation runs in one preparation. A local history strategy is
not run alongside native history. Rebuilt live contributions, tools, instructions
and the pending user input remain outside the archived prefix.

```typescript
const report = await agent.compactContext({ target: 'history' });
console.log(report.plugins, report.history);
```

| Target | Explicit operation |
| --- | --- |
| `all` (default) | Pressure-driven plugin reduction, followed by selected native history. |
| `plugins` | Pressure-driven plugin reduction; never invoke the native summarizer. |
| `history` | Try selected native history without evicting plugin content. |

Explicit history operations can run below the threshold. Set `automatic: false`
to schedule both phases explicitly between executions. It does not disable
`compactContext()`. The Agent's execution slot prevents overlapping run, stream,
rollover, native reduction and continuation operations.

Options also accept `signal`, a shared `modelTask`, and `checkpoint`.
Checkpointing defaults to enabled when session storage is configured. A newly
created session may receive its first generated ID; inspect `getSessionId()` or
save a chosen ID first. `checkpoint: true` without storage is rejected before
work. A skipped operation does not save a checkpoint.

Reports distinguish overall `compacted`/`skipped`, manual/pre-call trigger,
before/after input counts, accounting provenance, plugin names, history status,
provider/source references, optional native invocation ID and checkpoint status.
Skipped phases explain `disabled`, `not_selected`, `not_needed`, `empty`,
`protected` or `no_reduction` as applicable. Native calls can be billed even when
their candidate is rejected as `no_reduction`.

Observe automatic reports at `context.lastPreparation.compactionDetails`.
`inspectCapabilities().context.composition` includes detached settings, last
manual/automatic report and whether native state is active. Inspection makes no
provider call. Existing Stage 07 `lastPreparation.compaction` remains its own
optional report; existing unconfigured request/event shapes do not gain required
native fields.

## Provider support and exact replay

| Provider | Managed 16A path | Verification |
| --- | --- | --- |
| OpenAI Responses | Standalone `/responses/compact`; retain its entire canonical returned window; generation uses `store: false`. | `gpt-6-astra`: compact, continue, repeat, persist/restart and stream verified with actual API calls. |
| Anthropic Messages | On-demand `compaction: { type: 'summarize' }` with `compact-2026-09-04`; replay the exact signed block first. | `claude-sonnet-4-6`: model capability discovery plus the same live continuation/restart checks. |
| Google/other providers | No managed native adapter supplied by this stage. | Their existing managed paths remain supported and regression tested. |

`advanced.nativeCompaction` is optional capability metadata. OpenAI support starts
`unverified` for a model and becomes `supported` after a valid compact response.
Anthropic discovers `capabilities.compaction.summarize.supported` from its Models
API. Adapter availability/callability does not guarantee useful reduction. A
bounded `gpt-5.4-mini` probe retained the transcript and added a block; the library
kept the original history and accounted the attempt. Other model/endpoint
combinations need their own verification.

Native operations use the main Agent connector and model, including named
credentials and host identity. They do not route through `helpers.compactor`.
Client-owned continuation is the only managed ownership mode here. Raw automatic
compaction thresholds, server response IDs/conversations, hosted tools, opaque
continuation tokens and raw context/tool ownership overrides are rejected.
Initial supported content is text and ordinary local function-tool exchanges.
Known configured/per-call hosted-tool and server-continuation conflicts are
rejected before plugin reduction, source archival or a billable native call.
Manual targets use the same configured continuation controls as managed
preparation; inspecting a pending token does not consume it. Host hooks that
introduce new controls later are checked again at final dispatch.
Unverified multimodal/hosted/custom-result shapes fail explicitly; no fields are
silently omitted to obtain a token count. Retained Anthropic thinking across a
native boundary is rejected; a host can deliberately choose zero exact recent
turns or restore a compatible fresh/full checkpoint.
Anthropic native operations also reject top-level `ReasoningItem` before model
discovery, counting or archival: that Responses representation has no faithful
Messages mapping. OpenAI reasoning and valid Anthropic nested signed thinking
retain their provider-specific handling. Nested thinking must also be faithfully
replayable: OpenAI needs a nonempty provider item ID and encrypted content;
Anthropic needs a nonempty signature. Foreign or incomplete replay fields reject
before counting, reduction or archival. Ordinary non-native conversion is unchanged.

The OpenAI canonical window can include retained messages with phase, status,
annotations and other supported replay metadata. These are preserved alongside
the encrypted block. Anthropic content, signature, encrypted state and tool-change
fields are preserved together. Neither representation is a portable summary for
another model/provider. Returned control blocks never become an assistant answer.

## Protection, evidence and fit

Native history requires the enabled built-in evidence plugin and an acknowledged
scoped source store. The default enabled store is process-local; configure
`FileEvidenceStorage` or a suitable custom backend for restart recovery. The host
selects owner/tenant/namespace and account scope. A defined Agent user must match
the evidence owner. The native policy does not enable evidence implicitly.

The default keeps the two latest completed user turns exact:

```typescript
new ContextCompactionStrategy({
  plugins: 'auto',
  history: { mode: 'native', preserveRecentTurns: 4 },
  automatic: true,
});
```

Tool-only result messages are not user turns. The cutoff cannot split a connected
call/result group, an existing native window or a pending dependency. Pending
async calls and unacknowledged results remain protected. Historical actions need
matching acknowledged result-bearing evidence and settled completion before
their exchange can enter the source. Unknown completion never authorizes replay.
Current input, exact retained history, host task state and fresh plugin controls
remain protected at final dispatch, including formatting/repair.

Unlike observation masking and structured summaries, this explicitly selected
native policy can summarize older user messages and settled action exchanges.
Before replacement it stores an exact source snapshot, reads it back, and rejects
redaction/corruption/loss. Sources are discoverable through scoped evidence tools;
read exact records when an omitted detail matters. Native state does not guarantee
perfect semantic recall or prove an action completed. Storage/summary errors do
not justify executing an action again.

The complete frame is counted by the provider before reduction and after a
candidate. Opaque ciphertext length is not a token estimate. Native source fit is
bounded by the provider window, separately from a smaller host request budget.
Only a smaller candidate that fits the host request budget is committed.
Full final frames are counted after hooks; synchronous state/frame checks run
again at actual transport and SDK retries. Changes to scope, endpoint, model,
controls, tools or source during asynchronous work reject a stale result.

OpenAI counting and generation share request normalization, including supported
raw `instructions`, `text`/schema, reasoning, tool choice, parallel calls and
personality. Normalized options keep their existing precedence. Unknown raw
input/ownership controls that cannot be faithfully counted are rejected on the
native path; legacy/direct raw-option behavior is unchanged. Prefer normalized
Agent/run options when available.

Composition reuses its initial materialized frame until state changes require
rebuilding it. A history-only automatic reduction collects contributions before
and after replacement; plugin reduction can require an additional collection.
All phases carry the same cancellation signal and share the existing contribution
time allowance. A timed-out signal-observing contributor stops preparation before
native or main dispatch, rather than waiting for a separate host cancellation.

The existing `lifecycleHooks.beforeCompaction` may save facts to built-in notes or
whiteboard memory. When that hook changes plugin content or a companion revision,
automatic and explicit composition refresh/recount the frame once within the same allowance
before choosing reductions. It does not rerun the hook or start a second compaction
pass. Unchanged hooks reuse the initial frame. Host prompt/input, task state, tools,
policy, principal/scope and plugin/storage identities must remain stable; later
concurrent mutations still reject. The [runnable hook example](../examples/native-context-hooks.ts)
shows automatic or explicit native history with a preserved critical whiteboard
note, offline or with either supported live provider. Explicit operations invoke
the same preservation callback once and emit the existing compaction events;
`context:compacted` requires positive measured savings. Hook errors remain best
effort. Cancellation stops subsequent phases after an admitted hook mutation
settles; checkpoint retry saves the preserved note without repeating compaction.

`budget.providerCountedInputTokens` is optional count provenance, not billable
usage. Existing token estimates remain estimates and may include ciphertext
overhead; do not use their size to infer native capacity or savings. Fit checks
use the provider count. Stage 05 selected data uses the counted base-frame space;
selection remains a transient view, and final formatting retains that selection
and native history without another compaction pass.

## Usage, cancellation and failure recovery

Native calls have purpose `compactor` in the shared `ModelTask`. Counting/model
discovery are auxiliary I/O, not generation attempts. Main and native generation
share explicit call/token/cost/deadline reservations. An opted-in native execution
owns a task even without helper configuration; pass one task across explicit
operations to share a longer host budget. Unknown/partial usage stays unknown.
Anthropic native usage comes from `usage.iterations`, including cache input,
instead of its zero-filled top-level counters.

Reservations use conservative model capacities and can greatly exceed an ordinary
prompt. OpenAI's compact endpoint has no enforceable output-token parameter;
`maxOutputTokensPerCall` cannot be imposed on that operation and is rejected.
Use a host call/deadline budget and conservative cost/token bounds. A main-only
`before:llm` output cap is illustrated by the runnable examples.

Anthropic preserves the main thinking settings on the native call. Without an
explicit output bound, adaptive/disabled thinking retains the 4096-token native
default; fixed-budget thinking gets its resolved budget plus 4096 tokens for the
summary, bounded by the model output ceiling. For example, an 8192-token fixed
budget uses a 12288-token native output allowance. An explicit output limit or
`modelExecution.maxOutputTokensPerCall` is respected and never silently raised.
It must exceed the resolved fixed-thinking budget; known conflicts reject before
hooks, counting or archival. Native request bounds, source headroom and ModelTask
reservations agree. The main model's configuration is unchanged.

The Anthropic adapter uses internal streaming transport, including for large valid
output caps, and returns one complete signed result. Cancellation closes that
transport; a failed/truncated summary preserves history and retains acknowledged
iteration usage. This follows the provider's [on-demand request rules](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand).
The manual hook example demonstrates the fixed-thinking configuration in live
Anthropic mode. A main-only output cap must also leave room for its thinking budget. Registry costs
are estimates; see [Model Tasks](MODEL_TASKS_AND_HELPERS.md).

Source archival, count or native failure leaves original history intact. Plugin
reductions completed before a later phase fails may remain applied; errors carry
partial `compaction` diagnostics. A failed checkpoint after replacement carries
`contextCommitted: true`, with `compaction.checkpointed: false`: repair/save the
accepted state instead of repeating compaction or historical tools. Cancellation
does not undo billed work. Late model usage can settle diagnostically without
applying a stale native window. An old plugin that ignores cancellation retains
operation ownership until it settles.
Read-only retained-source, historical-action and archive-readback proofs honor
execution cancellation and ModelTask deadlines. A cancelled proof releases the
Agent's operation slot while a backend read may still be pending; its late result
or rejection cannot resume dispatch or commit a native window. The existing
storage contract gains no required signal parameter. An admitted archival write
continues holding ownership until it settles, so cancellation cannot race a new
operation against an unfinished write. A run/stream/manual operation waiting for
an already-started session restore can cancel its wait without poisoning or
bypassing that restore. The restore keeps its independent host/storage lifecycle;
the next turn waits for the same checkpoint before committing input or dispatching.
A standalone `Agent.resume()`/context load retains its existing storage lifecycle.

Version-1 session state gains only optional `nativeContinuation` metadata. It
binds the canonical prefix/hash, native protocol, source references and secret-free
model/connector/endpoint/principal/evidence scope, including SDK environment
endpoint defaults and configured OpenAI project/organization selection. Native load/preparation verify
source records. Credentials, role configuration, policies and ModelTask authority
must be reconstructed by the host. A trusted direct `restoreState` performs
structural preflight; asynchronous evidence verification happens before managed
use. Saved checkpoints themselves remain trusted host data.

Transport selection is captured when the provider is constructed, including SDK
environment defaults. Changing endpoint/project/organization configuration on an
existing Agent cannot relabel its already constructed client: native operations
reject configuration drift before I/O. Construct a new Agent for the new service
selection and restore only a compatible checkpoint, or deliberately start fresh.
Restoring the original configuration permits continued use of the original Agent.
Credential rotation within the same declared account remains supported; this
secret-free metadata does not authenticate which account a key actually belongs to.

Existing sessions/storage adapters need no new required members. Custom stores
used for native sessions must preserve the optional envelope unchanged; a
whitelisting serializer may need an opt-in field update. Older package
versions need not understand newly opted-in native sessions. Active native history
rejects model changes, local-history strategy switches and semantic rollover.
Save it and explicitly start a fresh context, or restore a trusted pre-native
checkpoint with `restoreState`/`loadSession`. Never recover by replaying writes.
The source-reference chain is bounded at 128 entries; replay metadata is bounded
at 64 KiB, with underlying evidence serialization/retention/backend quotas still
applying. Missing/expired proof stops use until host recovery. Persisted hashes normalize
JSON object-key ordering, so faithful JSON/JSONB stores can reorder keys; array
order, signed/encrypted strings and all actual values remain protected.

## Runnable examples and AMOS

Build first. All default modes use deterministic protocol fixtures, temporary
storage where needed, and clean up agents/connectors/tasks/files.

| Example | Expected result |
| --- | --- |
| `npm run example:native-compaction` | Independent plugin/history targets, smaller counted frame, early server-token rejection without a model call/history swap, and managed continuation. `-- --live=openai` or `-- --live=anthropic` uses `.env` and billable requests. |
| `npm run example:native-hooks` | Automatic native compaction preserves a fact written by one `beforeCompaction` hook. Offline by default; the same live flags use bounded OpenAI/Anthropic calls. |
| `npm run example:native-hooks-manual` | Explicit history compaction with `automatic: false` preserves the same note before checkpoint/continuation. Offline by default; add `-- --live=anthropic` for an 8192-token fixed-thinking budget, or `-- --live=openai`. |
| `npm run example:native-recovery` | Two compactions, a separate Node process, native session resume/stream, rejected model mismatch and trusted pre-native recovery. The same live flags exercise actual native state. |
| `npm run example:native-comparison` | Same bounded task under algorithmic, masking, structured summary and native; exact completion/constraint/no-repeat predicates. `-- --live` uses OpenAI main/helper/native calls. |
| `npm run example:amos-native-compaction` | Real AMOS configuration, protected/empty result, explicit reduction, inspection and saved-session resume. |

AMOS persists `contextStrategy: 'context-compaction'` together with explicit
`contextCompaction: { plugins, history, automatic }` settings. Old settings do not
enable it. Native history additionally needs explicitly enabled scoped evidence.

```text
/context policy auto native manual
/context compact plugins
/context compact history
/context strategy
/helpers usage
```

Omit `manual` for automatic operation; choose `off` independently for either
phase. `/context compact [all|plugins|history]` is host-owned and can checkpoint.
Selection itself makes no model call. Incompatible model/connector/scope/policy
changes preserve active native state and request explicit checkpoint/fresh-session
recovery. No provider-native API is exposed as an LLM-callable tool.

Provider contracts: [OpenAI standalone compaction](https://developers.openai.com/api/docs/guides/compaction),
[Anthropic on-demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand),
[Anthropic token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting).
The small live pilot validates these selected contracts; it does not establish a
general quality/cost ranking. Stage 16B remains deferred.


## Optional managed routes

[Stage 14A](./MODEL_ROUTING.md) binds pre-call counting/compaction to the selected
managed connector/model and active task. Native source guards compose with route
scope guards, including after reservation observers. Exact native ownership
continues across runs and save/load: only host-configured authorized routes can
resolve the checkpoint owner; saved policy does not grant access. An incompatible
default selection fails rather than transferring opaque state. Explicit idle
maintenance keeps its configured default owner. Anthropic source counting uses
compaction mode, preserving terminal assistant whitespace rather than treating it
as generation prefill. OpenAI's native hard-output-cap limitation still applies.
