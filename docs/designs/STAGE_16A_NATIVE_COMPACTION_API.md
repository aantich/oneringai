# Stage 16A — Native compaction API and delivery record

- **Status:** Revision 2 implemented on branch; all review corrections, including [T1–T3, are validated](STAGE_16A_THIRD_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-22). Package release unverified; no API break approved.
- **Date:** 2026-10-22.
- **Repository baseline:** `version2`, `4ab2c8f` (`stage 05`); clean working tree before this design.
- **Authorization:** On 2026-10-22 the user said “proceed with implementation” after the compatibility-first revision 2 presentation. This approves the optional composition strategy and bounded 16A delivery below. Stage 16B remains deferred; no breaking change is approved.
- **Compatibility:** Additive, explicitly selected behavior. No breaking change is proposed or approved.
- **Design revision:** 2 — plugin/history composition through the existing strategy extension point; compatibility reaffirmed by the user on 2026-10-22.
- **Parent plan:** [Agentic Architecture Evolution](./AGENTIC_ARCHITECTURE_EVOLUTION.md#stage-16a--native-compaction).

The design sections below retain the approved proposal and its acceptance gates.
The additive APIs are implemented on this branch; see the [native recipe](../NATIVE_CONTEXT_COMPACTION.md)
for current usage and the [review/correction record](STAGE_16A_REVIEW_AND_FIX_PLAN.md)
for subsequent findings and validation. Branch availability does not establish a
published package release. Existing APIs retain their supported contracts.

## 1. Recommended API

Backward compatibility is the starting constraint. Keep the existing `context.strategy`, `context.compactionStrategy`, plugin contracts and defaults. Add one optional strategy class through the existing `compactionStrategy` extension point, with plugin content and conversation history represented explicitly:

```typescript
import { Agent, ContextCompactionStrategy } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai-main', // Existing named connector; no new credentials.
  model,
  context: {
    model,
    features: {
      workingMemory: true,
      inContextMemory: true,
      toolCatalog: true,
      evidence: true,
    },
    compactionStrategy: new ContextCompactionStrategy({
      plugins: 'auto',
      history: 'native',
    }),
  },
});

await agent.run('Continue the investigation.');
```

`plugins` controls reduction of eligible plugin-owned content; `history` controls rewriting of older conversation history. Neither controls whether a plugin exists: features, stores, instructions, tools and contributor registration continue using the existing plugin APIs. Both settings are required on this new strategy so the composition is visible at the call site. `automatic` defaults to true.

| Selected strategy configuration | Plugin content reduction | Conversation history rewriting |
| --- | --- | --- |
| `{ plugins: 'auto', history: 'native' }` | Eligible plugins manage their own content first. | Native compaction if pressure remains. |
| `{ plugins: 'auto', history: 'off' }` | Eligible plugins manage their own content. | No history rewriting by this strategy. No native provider/evidence prerequisite. |
| `{ plugins: 'off', history: 'native' }` | No strategy-requested plugin eviction; plugins still render and expose their tools. | Native compaction of eligible history. |
| `{ plugins: 'off', history: 'off' }` | No reduction by this strategy. | No rewriting by this strategy; existing fit checks still apply. |

`model` must support native compaction only when native history is selected. The same native configuration works with an Anthropic connector and a supported Anthropic model. Vendor names, beta headers, encrypted blocks, and response IDs stay inside the adapters. Plugin-only mode works without a native adapter, including the existing Google managed text path.

Native history requires the existing evidence feature so the exact replaced source remains retrievable. The minimal example uses its process-local default. Production restart recovery requires an explicitly scoped durable evidence backend and session storage. No extra memory service or tool manager is introduced. Selecting this strategy does not silently enable any feature or backend.

Optional tuning stays inside the same strategy instance:

```typescript
const strategy = new ContextCompactionStrategy({
  plugins: 'auto',
  history: { mode: 'native', preserveRecentTurns: 4 },
  automatic: false, // Use the explicit host operation instead.
});
```

The proposed additions are:

```typescript
export interface ContextCompactionStrategyConfig {
  /** Allow existing compactable plugins to reduce their own content, or preserve it. */
  plugins: 'auto' | 'off';
  /** Native rewriting of eligible history, or preserve history verbatim. */
  history: 'native' | 'off' | NativeHistoryCompactionConfig;
  /** Default true. False disables strategy-requested automatic reduction of both. */
  automatic?: boolean;
}

export interface NativeHistoryCompactionConfig {
  mode: 'native';
  /** Default 2; a nonnegative safe integer. Pending dependencies may retain more. */
  preserveRecentTurns?: number;
}

export declare class ContextCompactionStrategy implements ICompactionStrategy {
  constructor(config: ContextCompactionStrategyConfig);
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly threshold: number;
  readonly requiredPlugins: readonly string[];
  compact(context: CompactionContext, targetToFree: number): Promise<CompactionResult>;
  consolidate(context: CompactionContext): Promise<ConsolidationResult>;
}
```

The existing `context.criticalCompactionThreshold` remains the automatic trigger, with its current default of `0.9`. Native utilization uses the whole provider-counted input frame against its usable capacity after applicable response/reasoning reserves, including tools and host contributions. Plugin-only mode uses the existing local request accounting. This is a client-side utilization trigger, not a vendor's automatic-compaction parameter. There is no additional native threshold or target-size knob. The required strategy `threshold` remains the existing reclaim-target interface; it does not promise a native compression ratio.

No new top-level `context.compaction` configuration or replacement strategy interface is proposed. Existing strategy names, custom instances and their precedence remain supported and are not deprecated. This new strategy needs no registry-name takeover or automatic substitution for an existing strategy. Presets accept it through their existing explicit `compactionStrategy` override; their normal defaults remain unchanged.

This revision changes the **unapproved draft**, which previously proposed `strategy: 'native'` and `NativeCompactionStrategy`. Neither exists in the implemented package. Replacing those draft names is not a change to an existing supported API. Revision 2 was approved on 2026-10-22; runtime implementation follows this contract.

## 2. Explicit compaction

Add one Agent method for hosts that choose when to compact:

```typescript
const report = await agent.compactContext(); // Both configured components.
console.log(report.plugins.status, report.history.status);

await agent.compactContext({ target: 'history' }); // Preserve plugin entries.
await agent.compactContext({ target: 'plugins' }); // No native compaction call.
```

The new method operates the explicitly selected `ContextCompactionStrategy` and can target `plugins`, `history`, or `all` (default). It refuses a concurrent run, stream, rollover, external/realtime execution, or another compaction. It does not invoke `run()`, produce an assistant answer, or execute tools. Existing arbitrary custom strategies are not silently reinterpreted as independently separable phases; using this new operation with another strategy fails clearly without invoking it.

Plugin reduction addresses actual context pressure using the existing reclaim target; it does not evict healthy plugin data just because a manual operation was called. An explicitly selected native history phase may run once below the trigger to prepare for future growth. Thus `target: 'history'` never evicts plugin entries, `target: 'plugins'` never calls the native summarizer, and manual `all` checks plugin pressure then explicitly attempts configured native history. A configured-off or unselected phase is reported as skipped. `automatic: false` disables both automatic phases while allowing these explicit operations.

```typescript
export interface AgentContextCompactionOptions {
  /** Default all. Targets only components enabled on the selected strategy. */
  target?: 'all' | 'plugins' | 'history';
  signal?: AbortSignal;
  modelTask?: ModelTask;
  /** Default true with configured session storage, otherwise false. */
  checkpoint?: boolean;
}

// Proposed method on the existing Agent class (interface view).
export interface Agent {
  compactContext(
    options?: AgentContextCompactionOptions,
  ): Promise<ContextCompactionReport>;
}

export interface ContextCompactionReport {
  /** Compacted if either phase reports a reduction; inspect each phase below. */
  status: 'compacted' | 'skipped';
  trigger: 'manual' | 'pre-call';
  /** Complete-frame counts with the provenance below; not billed usage. */
  inputTokensBefore: number | null;
  inputTokensAfter: number | null;
  accounting: 'provider' | 'local' | 'unavailable';
  plugins: {
    status: 'compacted' | 'skipped';
    reason?: 'disabled' | 'not_selected' | 'not_needed' | 'no_reduction';
    /** Plugins reporting reclaimed content; full-frame counts remain separate. */
    compacted: readonly string[];
  };
  history: {
    mode: 'native' | 'off';
    status: 'compacted' | 'skipped';
    reason?: 'disabled' | 'not_selected' | 'not_needed' | 'empty' | 'protected' | 'no_reduction';
    provider?: string;
    sourceReferences: readonly EvidenceReference[];
    /** Present if a billable native invocation was admitted. */
    invocationId?: string;
  };
  /** Whether this operation saved a checkpoint, not a claim about later saves. */
  checkpointed: boolean;
}
```

There is at most one attempt per selected plugin and one native invocation per operation. With no eligible prefix, the history phase returns `empty` or `protected` without a native call. A valid response that does not reduce the full candidate request returns history `no_reduction`, retains the old window, and still records actual usage. Source references and an invocation ID may exist on a skipped history result. Plugin-only success is distinguishable from native success; it never fabricates a native-attempt report or usage.

Overall success does not hide a phase error. If plugin reduction finishes and native compaction then fails, reject with safe details identifying completed plugin reductions and whether a native prefix was committed. Existing plugin reductions are best effort and are not transactionally rolled back; the native prefix swap itself is atomic. Do not report the whole operation as complete while a selected phase is failing.

Manual counts describe the current configured continuation frame, including retained history and current host contributions. They cannot include an unknown future user input or per-call overrides, and do not guarantee that the next `run()` fits. Managed preparation counts and guards that later actual request again.

Reports and inspection values are detached diagnostics. Mutating a returned report cannot change the active continuation, evidence acknowledgements or host scope.

Unsupported capabilities, invalid configurations, failed archival, invalid provider output, stale state, cancellation, and budget failures reject through existing error families. They are not successful compaction. A post-commit checkpoint failure must identify completed phases, `committed: true`, `checkpointed: false`, and any admitted native invocation ID in error details. The new in-memory state remains usable; saving it again does not repeat compaction or an external action. Cross-backend archival/session writes are not presented as a distributed transaction.

`checkpointed` records positive acknowledgement. A false value after a storage error or late cancellation does not establish that no checkpoint write occurred. Retrying an idempotent save of the accepted window is distinct from replaying compaction or historical actions.

`rolloverContext()` remains the existing local/helper summary operation. It does not become an alias for native compaction. Invoking an incompatible rewriting operation after creating a native continuation is rejected for that opted-in continuation.

## 3. Supported scope

The first delivery implements **on-demand native compaction with library-owned input-array continuation**. Automatic scheduling means OneRingAI decides when to make a separate compaction call; it does not enable automatic rewriting inside a generation request.

| Surface | Stage 16A contract |
| --- | --- |
| OpenAI Responses | Standalone `/responses/compact`; retain its complete returned window, in order. |
| Anthropic Messages | On-demand summarization; retain the signed block exactly and replace precisely the summarized prefix. |
| Managed `Agent.run()` / `stream()` | One bounded native attempt at a safe preparation boundary; ordinary generation follows. |
| Explicit `Agent.compactContext()` | Same adapter/transaction, between executions, with optional checkpoint. |
| Provider-native automatic thresholds | Deferred extension of 16A; not part of this implementation. |
| Server-owned `previous_response_id` / conversation chaining | Deferred extension of 16A; not part of this implementation. |
| Background native compaction | Deferred extension of 16A; this implementation waits at a guarded boundary. |
| Google GenerateContent / Vertex | Existing local strategies remain available; no native managed-text adapter claimed. |
| Realtime, Google Live, external SDK loops, direct calls, batch | Existing execution owner retained; this managed strategy does not enable compaction there. |
| 16B | No learned retention, future-plan prediction, hierarchical folding, parallel summarizers, or representation-model work. |

Start with text conversations and the library's local function tools. Retained reasoning must satisfy the concrete provider's replay rules. Native hosted tools, opaque custom provider extensions, and multimodal histories are admitted only when the adapter can preserve and count their complete protocol state; otherwise they are explicitly unsupported or protected. No blind JSON downgrade, text-only flattening, or omission is allowed to make a request pass.

Capability support is per provider, endpoint, model and request shape. A familiar model name or an OpenAI-compatible URL does not prove the endpoint implements compaction. The initial first-party adapters do not imply support for every Anthropic cloud platform or compatible gateway.

## 4. Ownership and source retention

The explicitly selected composition strategy coordinates plugin reduction and history rewriting as separate phases. There is one active **conversation-history rewriting** owner: its configured history mode. Existing default and custom strategies remain unchanged when this new strategy is not selected. Native history mode does not also run algorithmic pruning, observation masking, helper summaries, or post-cycle conversation rewriting against the same native continuation. Plugin state, memory persistence, and ordinary tool execution keep their existing owners.

### Plugin composition

Native history compaction and context plugins are complementary. The new strategy's `plugins` and `history` settings explicitly compose them inside the existing plugin-based context manager. Plugin state does not become part of a permanent provider summary.

| Context component | Owner with native history enabled |
| --- | --- |
| Host instructions and protected task state | Rebuilt from host/plugin state each request; never replaced by a native summary. |
| Working/in-context/long-term memory and custom plugin data | Existing plugins retain their stores, instructions, tools and persistence. Current rendered data remains a separate contribution. |
| Stage 05 selective data contributions | Explicitly registered companions retain their selection/budget/revision rules. Enabling native does not automatically convert every plugin into a selective contributor. |
| Tool catalog and tool definitions | Existing shared ToolManager/catalog owns visibility and current definitions; native mode does not freeze the catalog or create another tool pipeline. Provider-specific retained-reasoning compatibility is still checked when definitions change. |
| Evidence | Existing scoped storage retains sources and serves retrieval; it is not compacted away with history. |
| Older completed conversation prefix | Native adapter replaces only the eligible prefix with its complete canonical continuation. |
| Recent turns, current input and pending dependencies | Retained exactly under the existing guards. |

Under automatic context pressure, `plugins: 'auto'` enables one bounded plugin-reduction phase through the existing `isCompactable()` / `compact()` contracts, followed by rebuild/recount. `plugins: 'off'` skips that phase while preserving normal plugin contributions and tools. Only eligible plugin-owned content may shrink; protected task state, evidence, native continuation metadata and pending dependencies remain outside that phase. Invoke each selected plugin at most once, with no reclaim loop. Run configured native history compaction only if pressure remains and a safe prefix exists. If plugin reduction suffices, there is no native LLM call or charge. The unified report records plugin-only success and history `not_needed`, with no fabricated native invocation or usage.

This reuses the plugin-first capability of the existing default strategy without also running that strategy's conversation pruning. The new class is a small strategy using existing contracts, not a second context manager or a generic strategy-composition framework. It requires no new plugin methods. `automatic: false` disables both automatic phases; explicit operations follow the selected target and configuration. `target: 'history'` preserves plugin entries. Plugin data reductions follow their existing best-effort lifecycle and are not rolled back if a later native attempt fails; the native prefix swap itself remains atomic.

For example, an agent can combine a memory plugin holding document IDs, an evidence plugin holding exact documents, protected task state holding user constraints, Stage 05 selection limiting fresh retrieved excerpts, and native history carrying the older investigation. Every generation assembles fresh plugin context together with native history, the exact tail and current input. If fresh protected/plugin content alone exhausts capacity, native history compaction cannot solve that; the plugin/selection policy must reduce eligible data or the request fails explicitly.

The complete counted generation frame includes **all** those components. Changing a plugin contribution must be reflected on the next request and in its final freshness/count checks; an older native summary cannot substitute for the current view.

The active conversation becomes **the provider's complete canonical compacted prefix followed by the exact unsummarized tail**. `getConversation()` continues to expose active context, as it does with existing compaction. The source archive and optional history journal preserve the earlier transcript separately; the archive is not silently reinserted into every model call.

The strategy chooses a closed prefix before the last two completed user turns by default. It moves the boundary earlier to preserve connected tool calls/results and all dependencies of current input, pending local/native async operations, suspended work, and unacknowledged evidence. `preserveRecentTurns: 0` never removes those protections. A protected boundary can leave no compactable prefix; this is a visible skip, not permission to split a call/result group.

Native compaction is lossy model context. Unlike Stage 07's exact-user-message policy, this explicitly selected policy can replace **older user messages and settled historical tool exchanges**, including action arguments/results, with native continuation state. Exact source records must be acknowledged before replacement, and existing evidence protection cannot be released merely because a compaction snapshot was stored. Unknown/unsettled action completion, pending calls and unresolved evidence stay protected. An archive does not guarantee that the model remembers or retrieves every detail.

Current input, host instructions, protected task state, permission/identity scope, and newly selected plugin contributions are not delegated to the summary as authoritative state. They are rebuilt from current host-owned data for generation. Their fresh rendering must survive provider conversion, including Anthropic's special placement rules. A summary cannot grant permissions, confirm an action, change a task status, or become a system message. Native output is continuation data, even when some of it is readable.

Before any replaced prefix is removed, retain a bounded, acknowledged source snapshot through the existing evidence storage contract, using the same host-owned scope. Reuse the current context-source archival pattern; do not invent a second evidence API or fabricate an external action receipt. Preserve exact protocol items and references within backend serialization limits. If a faithful source cannot be retained, keep the original window and stop that attempt. Archive retention and pruning remain explicit host policy.

Archiving newly makes earlier chat content available to the already-enabled evidence tools under that same scope. This is an explicit native-policy behavior to document. Redaction and serialization rules still apply: a lossy/redacted archive cannot be described as an exact recovery copy. Sensitive or opaque state that cannot be faithfully retained must remain protected. Provider request logs, diagnostics and reports must not contain raw snapshots, signed content, encrypted payloads or credentials.

## 5. Transaction and final request checks

Reuse existing context operation gates, dependency grouping, evidence acknowledgements, scope capture, assembly revisions, and Agent execution leases. Add native-specific behavior behind an optional internal transaction capability; do not require new members from existing custom strategies or plugins.

Keep the existing plugin `compact(targetTokens)` signature. A custom plugin may not support cooperative abort; cancellation must stop subsequent phases and prevent stale generation, without claiming to roll back or forcibly terminate that plugin's mutation. Retain operation ownership until an outstanding mutation settles, and recheck state before further work. Do not require a new cancellation argument to make existing plugin implementations compile.

When selected and enabled, the bounded plugin-reduction phase above precedes the native attempt. Rebuild/recount after actual plugin changes, within the same preparation deadline, and capture native source/revision only afterward. Do not recursively call `prepare()` or repeat plugin reduction after native compaction. An explicit `target: 'history'` operation bypasses that eviction phase. Plugin-only composition skips all native capability, archival and summarizer work; existing full-frame local fit checks remain active. Existing active native continuation still requires its provider-count/replay guards even when the manual target is plugins.

One native attempt proceeds as follows:

1. Resolve the owning connector/model and verify native mode, evidence backend, request shape, and current capability information. Validate conflicting raw native flags before any compaction request.
2. Capture a detached prefix, exact tail, authority/scope, tool definitions, reasoning settings, selected contributions, and revision. No tool executes as part of compaction.
3. Obtain a provider count for the complete current continuation frame and ensure the compaction source itself still fits. Managed preparation includes its actual current input; manual calls cannot predict future input. Check count-request support before invoking the summarizer.
4. Archive and verify the exact source under the existing evidence scope, rechecking revision/scope/cancellation after I/O. A stale attempt cannot proceed on newly changed authority.
5. Admit one native call to the current `ModelTask`, then dispatch through the same named connector. Normalize its complete response and usage without ordinary empty-answer retry or structured-output repair.
6. Validate the returned protocol, required opaque state, order, provenance and complete candidate window. Append the unchanged tail, rebuild current host contributions, and obtain its provider count. Require a smaller fitting candidate before committing.
7. Recheck the captured state synchronously and swap the prefix once. Automatic preparation rebuilds the selected request after the swap; each plugin/history phase has a bounded rebuild and shares the preparation deadline. It never chases a target with repeated native calls or plugin passes. Manual compaction optionally checkpoints afterward.

The later generation dispatch retains final task-state, evidence, selected-contribution, hook and scope checks. With opaque continuation, a local string estimator is insufficient: count the frozen final provider frame after request hooks/listeners and validate its unchanged frame and host authority immediately before dispatch. Asynchronous counting must not open an unguarded mutation window. No hook, contribution collector, helper or compaction runs again as a side effect of the final guard.

Provider counts remain provider-reported counts/estimates, not a guarantee against every service-side limit. Store their frame fingerprint and provenance separately from existing numeric estimate fields. Never substitute encrypted string length for rendered token count. Missing/unsupported counting for an opaque request fails closed; it does not become zero or a fabricated token saving. Strict ModelTask reservations continue to use conservative capacity bounds, not an optimistic count.

Native fit/trigger decisions use that complete provider count. Existing local numeric estimates remain diagnostic estimates; an estimated ciphertext size must not independently reject a valid counted native window or be relabeled as exact usage. Unconfigured/local paths keep their present accounting and fit behavior. There is no automatic local-strategy fallback after a native error.

Reuse a count only for an identical converted frame and connector/model/scope binding. A bounded execution-local cache avoids duplicate network counts when hooks leave the frame unchanged. Bound source/candidate/final counting and discovery under the same deadline; no polling, background refresh, or unbounded recount loop is introduced.

After hooks change the model/connector, the native continuation must still match its binding; otherwise fail before generation. Changes to system/tools/thinking must satisfy that protocol's retained-reasoning rules. Current host authority may change between turns, but incompatible retained thinking cannot be silently stripped or replayed as if valid. A stale or invalid counted frame requires an explicit next attempt, not an automatic additional compaction pass.

If compaction succeeds but subsequent generation fails, the compacted prefix remains a valid continuation. Generation failure cannot justify repeating completed tools. A failed, cancelled or stale compaction leaves the original prefix active; any received billable usage remains recorded even when its output is discarded. Successfully written archival records may remain for explicit retention cleanup.

## 6. Provider extension contract

Reuse the optional-extension pattern already used for `ITextProvider.batch`. Existing providers do not gain required methods:

```typescript
// Proposed optional member on the existing ITextProvider (interface view).
export interface ITextProvider {
  readonly compaction?: ITextCompactionProvider;
}

export interface ITextCompactionProvider {
  /** A standalone operation; must not generate an ordinary reply or run tools. */
  compact(options: TextGenerateOptions): Promise<TextCompactionResponse>;
  /** Count the actual converted generation frame; null means unavailable. */
  countInput(options: TextGenerateOptions): Promise<number | null>;
}

export interface TextCompactionResponse {
  /** Complete canonical next prefix, not merely a summary extracted from it. */
  input: InputItem[];
  usage: TokenUsage | null;
  /** Adapter-owned protocol/version, not proof of host authorization. */
  protocol: string;
  providerResponseId?: string;
  /** Optional serializable replay metadata; never keys, SDK clients or callbacks. */
  state?: Record<string, unknown>;
}
```

`compact()` receives the validated compaction source and only compatible generation options. Adapters reject unsupported controls rather than silently ignore them. It must not inherit a forced tool choice or final-answer JSON schema. `countInput()` handles the complete ordinary request, including its schemas and definitions. The library still owns archival, source selection, scope checks, budgets and atomic application; the provider only implements its wire protocol.

Add an optional `nativeCompaction` member to `AdvancedTextCapabilities` with `onDemand: 'supported' | 'unsupported' | 'unverified'` and `inputTokenCounting: 'provider' | 'unavailable' | 'unverified'`. Missing metadata on legacy providers confers no native support. Static inspection does not perform authentication, model discovery, storage reads or an LLM call. Provider capability discovery, where required, occurs explicitly on first managed use and is scoped to the current connector/endpoint/model; a cached result cannot authorize another scope.

### OpenAI adapter

Use standalone compaction and preserve every returned item in its original order. An output containing retained messages plus an encrypted block must never be reduced to just that block. Repeated compaction submits the prior canonical prefix as part of the next source. Input-array continuation does not require stored response IDs. Source and returned-window handling follow the [official compaction guide](https://developers.openai.com/api/docs/guides/compaction).

The installed SDK exposes `responses.compact` and `responses.inputTokens.count`; verify exact supported parameters, opaque-item counting and model behavior against the official SDK and live service before marking this adapter complete. In particular, the compact request has a narrower option set than generation; do not forward tools/schema/output controls that its schema does not accept. See the official [Responses SDK source](https://github.com/openai/openai-node/blob/main/src/resources/responses/responses.ts) and [input token counting source](https://github.com/openai/openai-node/blob/main/src/resources/responses/input-tokens.ts).

### Anthropic adapter

Use on-demand compaction with the required beta, validate the compaction stop reason, and retain the returned content/signature unchanged. Its one signed block precedes the unsummarized tail; the summarized prefix is removed exactly once. Discovery must verify model support. Compaction and replay use the appropriate protocol header. Do not combine this mode with threshold compaction. These constraints follow [Anthropic's on-demand documentation](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand).

Parse billed compaction iterations rather than interpreting the top-level zero token counts as free usage. A missing summary, refusal, truncation or tool-use stop is a failed native attempt. Existing converter paths need targeted review: their broad compaction-block detection, trailing-assistant normalization, null serialization, and ordinary response usage handling are not sufficient evidence of a correct managed native lifecycle. Changes for the new adapter must preserve legacy behavior unless a separately reviewed correctness fix is required.

Use a bounded Anthropic compaction output default of 4,096 tokens, lowered by any tighter applicable existing output limit. Account for thinking within the provider's whole-call output cap. This is an adapter default for this new operation; it does not change ordinary generation defaults or add a misleading cross-provider output-cap setting.

Token counting has narrower request support than ordinary generation, including hosted-tool and media-source restrictions. Unsupported shapes cannot be counted by dropping their content. Verify signed-block counting with the beta and actual service; [Anthropic's counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting) does not establish every compaction combination by itself.

## 7. Persistence, scope and switching

Store the canonical active window in the existing conversation field, plus optional versioned native-continuation metadata in serialized context state. Retain the existing session-format version and required fields. The optional envelope records protocol, source references, canonical-window integrity, and a secret-free binding to the owning vendor, connector/account, endpoint identity, model, and evidence scope. It cannot restore credentials, permission policy, runtime callbacks, a ModelTask, or the host's choice of strategy.

Loading is preflighted before live context mutation. The host must configure native history on the composition strategy and the correct connector/scope again. Reject mismatched or incomplete bindings, incompatible protocol versions, corrupted windows, and missing required source records before generation. Expired evidence produces an explicit recovery error; it is not permission to reconstruct a transcript from a lossy summary. Existing sessions without the envelope continue loading under existing rules; unbound legacy opaque items are not automatically promoted into managed native authority. Switching active native history to `off` cannot discard its continuation; use explicit trusted checkpoint recovery. Changing plugin-reduction settings does not erase plugin stores or change their features.

New native snapshots require code that understands this envelope. Reading them in an older library is not promised. Existing custom storage adapters remain source-compatible, but restart support requires preserving the optional metadata and the scoped evidence records. Round-trip tests must cover bundled storage and an unchanged custom adapter.

Native continuations are bound conservatively to the same provider/model/connector identity. Do not infer portability from a model-family name or a readable summary. Credential refresh for the same configured identity remains possible; switching an account/endpoint or configured model cannot silently rebind native state. Record a resolved model version where the provider exposes one. A moving server alias without a stable resolved version cannot support a guarantee of revision identity; document this limit and preserve the prior window on provider rejection.

Account binding relies on trusted host connector/account identity and evidence scope, not inspection of an API key. Replacing credentials with another account while reusing the same host identity cannot be reliably detected from a key string. Hosts must keep those identity assignments accurate; snapshots never persist credentials or claim to verify account ownership.

Rollback means restoring a trusted pre-native checkpoint/source into a compatible fresh context and selecting a local strategy. Merely deleting the native block, changing the active strategy, or asking a different model to interpret ciphertext is not a migration. This stage includes a documented recovery example using existing checkpoint/evidence APIs; it does not add a general transcript migration or replay engine. No source recovery path repeats historical tool execution.

The recovery example saves its portable checkpoint **before the first native compaction**. A later archived source may itself contain an earlier opaque continuation; it is not automatically a portable full transcript. Do not promise rollback to an unrelated model from that later record alone.

## 8. Usage and diagnostics

Native compaction uses the **main connector and model**, independent of `modelExecution.helpers.compactor`. It cannot switch to a cheaper model without a separate portability contract. Existing structured-summary/rollover helpers remain the option for explicitly configured helper-model compaction.

Record native calls with existing `purpose: 'compactor'` accounting, the same active ModelTask, attempt tracking, signal/deadline and conservative pricing reservations. A manual call can join an explicitly supplied ModelTask; otherwise it uses the existing owned-task lifecycle. Explicitly selecting native also enables an execution-owned ledger when none was supplied, so its main and native calls are accounted together; it adds no implicit monetary limit. The default non-native lifecycle is unchanged. Count/discovery network requests are separately bounded and cancellable; they are not misreported as generation calls or fabricated token usage. Any real charge must be included or reported unknown.

Honor existing enforceable output/cost limits. A provider endpoint without a requested hard output cap must not appear to honor it: use a valid conservative reservation or reject an unenforceable hard limit before dispatch. Keep partial/unknown usage and pricing uncertainty visible. A reduced prompt does not establish lower total task cost.

Add `lastPreparation.compactionDetails?: ContextCompactionReport`, leaving the existing local compaction diagnostic unchanged. Automatic attempts use the same report shape as explicit calls, showing the plugin and history phases independently, including disabled/no-op and plugin-only outcomes. Existing compaction events remain compatible; new details are optional fields. Reports contain counts, IDs and scoped references, not native payloads. Existing `agent.getModelUsage()` / `task.snapshot()` remain the detailed usage surfaces.

Keep ordinary response/event usage fields attached to their existing generation call. Whole-task native plus main totals come from the shared ledger; do not silently change legacy per-response usage semantics.

Extend `inspectCapabilities().context` with optional composition metadata: selected plugin-reduction policy, eligible compactable plugin names, history mode, automatic setting, and native support/counting/replay/durability where applicable. Expose both configured and effective behavior. Preserve its no-I/O contract and distinguish verified support from unverified configuration. Plugin-only mode must not be described as an unsupported native operation. AMOS reads this metadata rather than inferring support from the vendor string.

## 9. Compatibility decisions

| Existing surface | Required behavior |
| --- | --- |
| Default Agent/context and presets | No changes to selected strategy, trigger, prompt, tools, helper calls or background activity. Native is never selected by a preset silently. |
| `strategy` / `compactionStrategy` | Existing names, registry behavior and instance-over-name precedence preserved. Add an optional class via the existing instance extension point; no replacement configuration, registry-name takeover or expanded required interface. |
| Custom providers/plugins/strategies | Existing implementations still compile and execute unchanged; native provider capability is optional. |
| `run`, `stream`, direct/SDK/realtime APIs | Existing signatures/event shapes retained; native lifecycle is opt-in managed behavior only. |
| Tool/evidence/task state | Same ToolManager, permission rules, execution outcomes, acknowledgement and protected-state guards. |
| Context/session APIs | Existing required fields and old-session loading retained; new optional native metadata has explicit support rules. |
| `vendorOptions` native escape hatches | Existing low-level use remains available; combining conflicting ownership flags with the new managed native strategy is rejected only on that opted-in path. |
| Public package exports | New types/class/method exported from documented surfaces; API reference generated from implementation after approval. |

The changed history-retention policy applies only to users who explicitly select native history on the new strategy. No existing supported API is removed, renamed, deprecated, automatically wrapped, or made to require migration. Existing built-in/custom strategies continue owning their existing full behavior; do not split or reinterpret them internally to implement the new class. Existing presets accept the class through the same explicit instance override and do not silently select it.

Before feature implementation, pin compatibility fixtures for existing built-in/custom strategy configurations, unchanged custom plugin/provider/storage implementations, saved sessions, default request/hook/event traces, public ESM/CJS and TypeScript consumers. Run those unchanged fixtures throughout the stage. Omitting the new strategy must add no native calls, counting/discovery I/O, archival, prompt content or required configuration. Adding optional diagnostic/session/provider fields must preserve existing required fields and meanings. These are behavioral and persistence requirements, not merely successful compilation.

No breaking API change is proposed. If implementation reveals that a supported existing contract must change, stop that affected work, explain the specific reason, affected consumers, alternatives and migration, and obtain separate explicit approval under the standing compatibility rule. Neither approval of this new class nor Stage 16A authorization approves a break.

## 10. Implementation sequence after API approval

These are work increments within **16A**, not authorization for other roadmap stages.

| Increment | Deliverable | Required evidence before moving on |
| --- | --- | --- |
| 16A.1 | Pin compatibility fixtures first; additive composition class/types and optional provider extension; capability/error preflight. | Existing strategy names/precedence/default traces and custom contracts stay unchanged; plugin-only/off combinations need no native adapter/evidence; native prerequisites fail before mutation. |
| 16A.2 | OpenAI and Anthropic adapters, response normalization, counting and correct usage. | Recorded/mock wire contracts plus bounded real compact-and-continue calls for both providers, including repeated compaction and actual usage inspection. |
| 16A.3 | Source archive, prefix selection and revision-checked native transaction; explicit method. | Fault injection at every async boundary; intact dependencies, cancellation, stale scope, no-reduction and post-commit checkpoint outcomes. |
| 16A.4 | Managed run/stream scheduling, final frame guards, structured formatting, loop and ModelTask integration. | Real Agent/context/tools/storage mock integration; shared-budget and hook-race regressions; no duplicate tools or extra compaction/repair passes. |
| 16A.5 | Versioned optional persistence, supported restart and recovery, capability inspection, AMOS UI. | Separate-process resume, scope/model/endpoint rejection, legacy storage/session consumers, AMOS configuration/command/help tests. |
| 16A.6 | Runnable examples, documentation handoff, bounded comparison and full validation. | Complete local/public/AMOS gates, relevant full live suites across all three providers, two-provider native contracts, evidence records and an independent review pass. |

If an adapter cannot meet its counted-frame or replay contract on a currently supported service, fix the cause before calling 16A complete. A rejected request or missing credential is not a passing native-provider test. Any requested scope reduction requires a user-visible decision and an updated delivery record.

## 11. Test and example plan

**Protocol and normalization:** Preserve OpenAI's complete returned window, retained user messages, item order and repeated compaction. Preserve Anthropic's exact block/signature and appropriate beta; reject wrong placement, duplicate/missing blocks, malformed signatures, refusals, truncation and ordinary tool replies. Mock count/compaction endpoints with real converters and check the request sent over the transport. Include Anthropic iteration usage, cache counters, absent/partial usage and no phantom zero cost. SDK types alone are not live protocol validation.

**Context and safety:** Test exact recent turns/current input; tool-group closure across the prefix boundary; pending async/native calls; unsettled actions; unacknowledged evidence; source-size/backend quotas; archival failure/corruption/redaction; task-state refresh; selected data and stable layout; dynamic schema changes; retained-thinking validity. Include invariants across generated boundary positions rather than only fixed happy-path examples. Cover all four plugin/history combinations, `automatic: false`, and all three manual targets. Test plugin-only reductions avoiding native calls, noncompactable/critical state staying intact, once-per-plugin bounds, history-only calls preserving plugin entries, plugin changes preceding native snapshot capture, partial-phase failures, and independent plugin/history persistence. Verify default/user plugins, explicit Stage 05 companions, memory, task state, evidence and catalogs together; do not claim every custom plugin supports shrinking or selective assembly automatically.

**Concurrency and failure:** Change user/scope/account/endpoint, system/tools, context revision or selected contribution while archive, discovery, counting or compaction is pending. Cover abort before dispatch, during native response, after response and before swap; late usage; concurrent operations; destroy; failed checkpoint after commit; snapshot/load failure with no partial mutation. Verify no recovery repeats a write or discards a protected result.

**Managed integration:** Exercise run and stream, multiple tool iterations, final dispatch mutations/listeners, budget observer reentrancy, empty-response recovery, loop completion checks, final structured formatting/repair, suspension and async continuation, save/load and explicit manual scheduling. Summarizer control output must not be shown as the assistant answer. There is at most one native summarizer invocation per preparation; provider transport retries remain visible/accounted and are not unlimited semantic retries.

**Budgets and counting:** Share a ModelTask between main/native calls, test call/token/cost/deadline exhaustion and conservative reservations, and retain billed discarded results. Verify identical final-frame counting and invalidate counts after hooks or scope changes. Cover unsupported count shapes, opaque input, HTTP errors/rate limits/cancellation and no local ciphertext-size fallback. Unknown data stays unknown. Model discovery/counting must share the execution deadline.

**Compatibility:** Preserve Stage 00 fixtures, ESM/CJS public imports, built-package consumers, existing strategy names and instance precedence, default/preset request and lifecycle traces, unchanged custom providers/plugins/strategies/storage and optional session fields. New-class opt-in must work as an ordinary custom strategy instance, including explicit preset overrides, without changing the existing path. Test both plugin/history settings serialized by AMOS, while runtime capability/authorization is reconstructed. An older package need not read newly opted-in native snapshots; loading its existing sessions into the new package remains required.

**Live provider contracts:** Use existing named connectors and `.env` credentials without logging secrets. Explicitly select current supported models and bounded source histories. For OpenAI and Anthropic verify compact → continue → compact again → save/restart → continue, exact source retrieval, input counts and billed usage. Run a small run/stream continuation matrix; use deterministic failure injection for races rather than expensive flaky live timing assertions. Google receives regression coverage on its existing managed path; no fictional Google native compaction test or success claim.

Deliver and validate these approved examples:

- `examples/native-context-compaction.ts`: deterministic mocked-provider mode requiring no keys; opt-in live provider modes with an explicit call budget and documented model setup, output, archival and cleanup. Show the existing unchanged setup alongside plugin-only, native-only and combined opt-ins, manual targets, and per-phase results. Use the existing feature/store configuration; do not hide plugin prerequisites in a native helper.
- `examples/native-context-recovery.ts`: scoped durable evidence/session storage, real separate-process restart, rejected cross-model resume, and restoration of a trusted pre-native source/checkpoint without executing old tools.
- `apps/amos/examples/native-compaction-offline.ts`: inspect actual capabilities and counts, compact manually, display a protected/no-reduction result, and recover a saved session through the real AMOS adapter.

Compare the same bounded completion-checked workload with algorithmic, observation masking, structured summaries and native compaction. Include original task success, constraints, evidence/source retrieval, main + compaction calls/tokens/cost, failures and uncertainty. Hold task/tool results constant across comparable runs; label mocks as protocol tests. This is a functional pilot, not a claim that native compaction is universally cheaper or more accurate. No retention-model training or 16B experiment is needed.

## 12. AMOS and documentation handoff

Preserve existing strategy selection/settings. Add an explicitly selected composition option with separate plugin and history controls, without assuming a new registry name. Show prerequisites/support independently: plugin-only mode does not need a native provider or evidence; native history does. Add host-owned `/context compact` targets and per-phase status/count/last-attempt inspection. Persist both controls through the existing AMOS strategy adapter; reconstruct the new strategy only when explicitly selected. Model/connector/settings changes must preflight an existing native continuation before replacing active state; incompatible changes offer documented fresh-context/checkpoint recovery rather than discard the block. Do not silently enable evidence or native policy when loading old settings.

During implementation update README, User Guide, the generated API reference, Agent Guide, context preparation/strategies/evidence/helper-budget guides where affected, examples index, AMOS docs/help/tests, Changelog, package documentation inventory, this roadmap and the Version 2 availability/adoption/handoff records. Publish a native-compaction usage recipe only when signatures and examples are verified. Planned filenames and snippets in this proposal are not links to nonexistent shipped files.

The approved design is retained below. Implemented public usage is documented in [Native Context Compaction](../NATIVE_CONTEXT_COMPACTION.md), with generated API and Version 2 adoption/handoff records.

## 13. Approval checkpoint

The recorded revision 2 approval covers:

- The optional `ContextCompactionStrategy` class supplied through the existing `context.compactionStrategy` field, with explicit plugin/history controls and optional automatic scheduling.
- `agent.compactContext()` with independent targets/results, additive diagnostics and optional provider extension.
- OpenAI standalone plus Anthropic on-demand adapters with client-owned continuation, faithful source archival and guarded counting/persistence; existing context plugins/selection compose with native history, including a bounded automatic plugin-reduction phase.
- The implementation/test/example/AMOS/docs sequence above, with defaults and existing APIs preserved.

Server-owned continuation, in-request native automatic thresholds and broader runtime/request shapes remain deferred extensions of 16A. Stage 16B remains separately deferred. The user approved revision 2 on 2026-10-22; the bounded implementation and all review corrections are complete on branch. No breaking API change or package release is approved or asserted.

## 14. Historical design validation — 2026-10-22 (before implementation)

Reviewed current Agent/context/strategy/provider/usage/storage contracts and the primary provider sources linked above. The user's composition and compatibility feedback led to revision 2: use the existing strategy instance extension point, expose plugin/history controls and per-phase operation/results, and pin unchanged compatibility fixtures before feature implementation. No runtime code or current supported API changed. Documentation link/anchor, whitespace and proposed TypeScript syntax checks validate the design only; they do not typecheck or execute the proposed APIs. No implementation tests or live LLM calls were run for this documentation-only change. Stage 05 validation remains historical and is not attributed to 16A.

## 15. Implementation validation — 2026-10-22

The approved 16A.1–16A.6 implementation was delivered on branch. All third-review corrections are validated; see [corrective completion](STAGE_16A_THIRD_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-22). Prior delivery validation is retained below. See the
[roadmap completion](AGENTIC_ARCHITECTURE_EVOLUTION.md#stage-16a-completion--2026-10-22),
[native usage recipe](../NATIVE_CONTEXT_COMPACTION.md),
[validation evidence](../evaluations/STAGE_16A_VALIDATION.json) and
[Version 2 adoption](../VERSION_2_GUIDE.md#stage-16a-adoption-record--2026-10-22).
8,420 units, 194 live tests across three providers, 32 offline programs, 158 public
ESM/CJS checks, all strict/build/AMOS/documentation gates and the bounded four-policy
live pilot pass. Review was a whole-diff self-review plus independent wire contracts,
fault-injection checks and separate-process recovery; no separate agent was spawned.
The OpenAI and Anthropic native repeat/restart/stream contracts are verified. No
required work or known test failure remained at that delivery checkpoint. The
third review subsequently identified T1–T3, now corrected and validated. No break, release, extra
stage or Stage 16B work was authorized. Support boundaries above remain explicit.
