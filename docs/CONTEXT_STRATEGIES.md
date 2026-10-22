# Opt-in context strategies (Stage 07)

Stage 07 is complete on `version2` as an experimental opt-in delivery, including
all three review corrections (2026-10-15). The current gate passes 7,631 units and
105 live cases in one batch. See the [corrective completion](designs/STAGE_07_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-15)
and [evidence](evaluations/STAGE_07_CORRECTIONS_VALIDATION.json). Earlier review,
pilot and validation records remain historical snapshots. No package release or
promotion of a new default is claimed.

Algorithmic remains the default. Two additive built-in registrations are available
through `StrategyRegistry`: `observation-masking` and `structured-summary`. They
are experimental alternatives for long tool-using tasks; a shorter prompt alone
does not establish better quality or lower total cost.

## Choose a strategy

| Strategy | Behavior | Additional model work | Retained source |
| --- | --- | --- | --- |
| `algorithmic` | Existing scratch spill and rolling window | None | Existing working-memory policy |
| `observation-masking` | Replace eligible older read bodies with scoped evidence references | None | Acknowledged evidence snapshot |
| `structured-summary` | Summarize older assistant narrative and mask eligible read bodies | Configured compactor; at most one schema repair | Acknowledged evidence snapshot |

New strategies operate only in the existing bounded pre-call preparation pass.
Their post-cycle `consolidate()` is a no-op. Explicit `rolloverContext()` keeps its
existing between-executions contract and cannot race preparation. Do not compact
or roll over separately in application code before every managed call.

```typescript
import {
  Agent, FileEvidenceStorage, ObservationMaskingStrategy,
  StructuredSummaryStrategy,
} from '@everworker/oneringai';

// Register named main/compactor connectors separately. Scope comes from the host.
const storage = new FileEvidenceStorage({
  directory: './agent-data/evidence',
  scope: { ownerId: 'user-123', namespace: 'assistant' },
});
const agent = Agent.create({
  connector: 'main',
  model: 'gpt-4o',
  userId: 'user-123',
  modelExecution: {
    limits: { maxCalls: 8 },
    helpers: {
      compactor: {
        connector: 'compactor',
        model: 'gpt-4o-mini',
        allowContextTransfer: true,
        thinking: { enabled: false },
        maxInputTokens: 16000,
        maxOutputTokens: 1024,
      },
    },
  },
  context: {
    model: 'gpt-4o',
    features: { evidence: true },
    plugins: { evidence: { storage } },
    compactionStrategy: new StructuredSummaryStrategy({
      preserveRecentTurns: 2,
      preserveRecentMessages: 4,
      maxSourceTokens: 8192,
      maxSummaryTokens: 1024,
      fallback: 'mask',
    }),
  },
});
try {
  await agent.run('Continue the task.');
  console.log(agent.context.lastPreparation?.compaction);
  console.log(agent.getModelUsage());
} finally {
  agent.destroy();
}
// For helper-free masking, configure new ObservationMaskingStrategy() instead.
// Runtime switching uses agent.context.setCompactionStrategy(...), between calls.
```

The example models illustrate configuration, not a cheapest-model recommendation.
Use evaluated roles for your workload. Compactor calls share the active host-owned
`ModelTask`, including main calls, helper repair, deadlines and conservative
reservations. Cross-connector transfer requires `allowContextTransfer: true`;
provider-opaque items never enter its packet. Profile capacity and schema overhead
are checked before dispatch. Provider reasoning can share the helper output cap;
in the Google probe, requesting disabled thinking still left provider-default
reasoning active. That helper uses 4096 output tokens of headroom; actual inclusive
reasoning usage is recorded. Do not assume a unified disable request is honored
by every provider, or confuse the capsule limit with guaranteed visible output.
Missing usage/cost remains unknown. Read the
[helper recipe](MODEL_TASKS_AND_HELPERS.md) before configuring hard limits.

## What remains exact

All user messages, including corrections, remain verbatim. Host instructions and
plugin state are not summarized. Tool names, call IDs, arguments and receipt
metadata remain exact. Only a read observation matched to an acknowledged stored
result with settled completion is eligible. The current raw body and arguments
must agree with that stored observation; a redacted mismatch or host modification
protects the group. Write/unknown effects and unknown completion stay exact.

Pending call/result dependencies, unresolved async calls, the two most recent user
turns and four trailing history items are protected by default. Native output-only
representations without matching evidence metadata, multimodal groups, thought
signatures and opaque provider replay items are preserved. They can still prevent
a request from fitting; the strategies do not remove them to meet a token target.

The summary schema contains `completedWork`, `activeWork`, `constraints`,
`decisions`, `uncertainties`, `artifacts` and `actionReceipts`. Each section contains
bounded `{ text, sourceIds }` entries citing the retained source. Automatic helpers
receive a compact two-entry-per-section schema and brevity instructions; the host
callback boundary additionally enforces an outer cap of 12 entries per section
and 600 characters per entry before apply. Capsules follow the older material they summarize, ahead of the exact recent
window. They explicitly identify historical state that may be stale; current user
and host instructions govern. They are assistant context data, never system/developer
instructions. The compactor prioritizes observed facts and exact identifiers over
generic progress chatter. Automatic helpers additionally validate at least one
nonempty section and nonblank entries of at most 600 characters locally, inside
the existing bounded repair. The native wire schema stays portable. An all-empty
JSON response is recorded as failed validation and can receive one charged
repair with the original retained source; it cannot bypass repair by merely
matching the native shape. Exhausted repair still obeys `mask`/`error` fallback,
while cancellation/deadline and task budgets keep their existing limits.
Standalone host callbacks are still invoked once and checked at the transaction
boundary. Exact user/action
content remains separately available. A schema and a valid source ID do not prove
that a generated statement is true or complete. Retrieve source evidence before
acting on omitted details or ambiguous summary claims.

## Retention, recovery and limits

Both strategies require the enabled built-in evidence plugin. Its default store
is process-local; use `FileEvidenceStorage` with stable host scope, or a custom
acknowledged store, when references must survive restart. Saving a summary does
not restore storage authority, credentials or helper configuration.

Source capacity is allocated only to complete groups that the policy can change.
Standalone exact user messages and unchanged narration under masking remain in
history without consuming that allowance. If user text belongs to an eligible
connected tool group, it stays exact and is included in that group's retained
source; the whole group must fit. The helper receives affected groups rather than
every older message. Exact user constraints remain in the main context.

An optimistic saving check includes reference/capsule overhead and configured
minimums before source writes or helper requests. Known no-ops perform neither,
even above the critical gate with full storage. When only masking can meet those
bounds and fallback permits it, summary mode masks with `helperInvoked: false`.
Uncertain proposals still need the actual reference/output and final recounting;
this preflight does not promise that every admitted proposal will save enough.

Before replacing anything, the transaction retains the complete selected JSON
source through the evidence plugin's existing redaction, retention, timeout and
serialization policy. Optional undefined object fields have no JSON value and are
omitted from the archive; live retained metadata is unchanged. Internal
`__context_source__` records are source bookkeeping rather than external action
receipts. They appear in `evidence_list`; use bounded `evidence_read({ id, offset,
limit })` to inspect their `result.items`. There is no synthetic tool execution
or extra execution event for these writes.

The source is read and compared before helper transfer and before apply. A changed
redaction result, failed/expired/evicted source or stale history/input/scope/strategy
prevents application. Concurrent work is preserved; retry preparation from current
state after resolving the cause. Source storage is independent of the in-memory
commit: an unused acknowledged source can remain after a rejected proposal, and
host retention maintenance owns its eventual deletion. No multi-store atomicity
or universal durability is promised.

Defaults for both new constructors:

- `threshold: 0.75` is the reclaim target; the existing context critical gate
  controls when preparation invokes compaction.
- `preserveRecentTurns: 2`, `preserveRecentMessages: 4`.
- `minObservationTokens: 256` minimum estimated saving for an individual masked
  body, `minTokensSaved: 32` minimum saving for the whole proposal.
- `maxSourceTokens: 8192`; complete groups exceeding the source allowance stay exact.
- `timeoutMs: 30000` bounds the whole transaction, including storage and callback.
- Structured summaries additionally use `maxSummaryTokens: 1024` and
  `fallback: 'mask'`; the configured helper's tighter output cap still applies.

A malformed/empty/oversized summary, helper admission failure or insufficient
summary saving permits one masking fallback using the same retained source.
`fallback: 'error'` propagates summary failure. Cancellation/deadline expiry, stale
state and lost source never authorize a fallback commit. A no-op or incomplete
reduction is rebuilt and recounted by preparation; failure to fit raises an explicit
context limit error before the main model is called. A valid partial reduction can
remain even when other protected content still makes the final request too large.
No external action is repeated to regenerate missing evidence.

`agent.context.lastPreparation?.compaction` reports the strategy, pre-call trigger,
estimated before/after tokens, actual applied reduction, references, fallback and
helper correlation/returned model. `helperInvoked` means the summary callback was
requested; admission can reject before any model dispatch. Read `getModelUsage()`
or the shared task snapshot for actual calls, known charges and unknowns. Diagnostics
are process-local, reset by a preparation without transactional compaction, and
are not restored as budget authority by session loading.

A standalone `AgentContextNextGen.prepare({ summarize, signal })` may use an
explicit host callback returning `{ summary }` (optional correlation metadata).
The callback receives detached JSON items, the source reference, schema, output cap
and cancellation signal. The host owns its model accounting and data-transfer
permissions. Managed Agent calls bind their configured compactor automatically.
Automatic helper binding covers managed Agent run/stream/async-continuation
preparation. Standalone preparation and external transports assembling context
themselves must provide the host callback; provider-owned/Codex context management
is outside this strategy guarantee. Existing custom strategies and contexts remain valid; the new controlled
`CompactionContext.compactConversation` capability is optional. These two built-ins
fail clearly if called with a legacy hand-built context lacking that capability.

## Examples, AMOS and evaluation

- `npm run example:context-strategies` runs deterministic offline development tasks.
  `--held-out` runs six frozen task variants. All usage/answers are scripted in
  offline mode, with no credentials/network. Owned agents/connectors are cleaned up;
  evidence is deliberately process-local in this example.
- `npm run example:context-strategies -- --live --held-out` uses `.env` OpenAI
  credentials and makes real billable main/helper calls: six tasks, two repetitions
  and three strategies in seeded shuffled order. `CONTEXT_STRATEGY_REPORT_PATH`
  optionally writes the complete report. No external writes are performed.
- `npm run test:context-strategies:live` adds actual OpenAI/Anthropic/Google structured
  compaction probes to that comparison. Explicitly enabled missing keys fail.
- AMOS: enable evidence in host configuration, configure `/helpers set compactor`
  where needed, then `/context strategy observation-masking` or
  `/context strategy structured-summary`. Selection preserves the existing agent
  and session, persists `contextStrategy`, and makes no immediate helper request.
  `/context strategy` inspects the last transaction; `/helpers usage` shows complete
  task accounting. `/context strategy algorithmic` restores the default choice.

The common comparison environment uses a bounded source reader for both evidence
IDs and exact scratch keys, with identical main-model instructions and call caps.
Predicates check exact answer/account/status, no repeated action and the read-only
fixture's no-write outcome. Reports include failures, main/helper/repair attempts,
returned models, known/unknown usage and model cost, source reads, compaction saving
and observed latency. External service fees are excluded. The bounded live pilot
cannot establish statistical non-inferiority, a production reliability rate or
general cost reduction. Both alternatives remain experimental and opt-in;
algorithmic stays the default and baseline.

## Original branch validation (before review corrections)

The final implementation passes 7,594 units / 349 files, including 121 Stage 07
cases; 66 existing live baseline cases and 39 new live cases (36 comparisons plus
OpenAI/Anthropic/Google probes); and 17 offline examples. Public ESM/CJS, strict
types, compatibility, build/lint, examples, AMOS and generated API pass. The live
gate combines retained baseline and final fresh-pilot batches; it is not a claim
that every earlier batch passed. The three new strategy modules have 97.22% line,
88.70% branch and 100% function coverage; Agent/context/AMOS integration is covered
separately and excluded from those percentages.

Each strategy completes 12/12 final synthetic cases. Algorithmic and masking use
24 model attempts / 12 source reads each; structured summaries use 36 attempts /
12 reads, including every helper. These counts are observations, not general
quality/cost conclusions.

| Final pilot strategy (12 cases each) | Model attempts | Input / output tokens | Estimated model cost | Median wall time |
| --- | ---: | ---: | ---: | ---: |
| Algorithmic | 24 | 54,967 / 658 | $0.14256 | 2.20 s |
| Observation masking | 24 | 56,276 / 879 | $0.14948 | 2.46 s |
| Structured summaries | 36 | 143,985 / 4,484 | $0.16116 | 5.99 s |

The summary path costs more and takes longer in this pilot, with the same final
completion count. Helper input/output and every actual model attempt are included;
provider probes, earlier failed pilots and external/storage fees are outside this
table. Prices are registry estimates, caching was uncontrolled, and these medians
are observations rather than production latency guarantees. This evidence supports
keeping the existing default and evaluating alternatives on the host's workloads. Earlier schema/capacity, output-contract, transport and
historical-summary failures remain in the [validation record](evaluations/STAGE_07_VALIDATION.json)
and [comparison evidence](evaluations/STAGE_07_LIVE_COMPARISON.json). The held-out
splits were replaced after diagnostic changes; consumed variants are preserved.
One overwritten development usage report is disclosed and its recovered answer
observations are labelled excerpts. See the [completion record](designs/STAGE_07_IMPLEMENTATION.md#completion--2026-10-15)
for the full scope, limits and next separately authorized stage.

## Corrective validation

All three findings are resolved: 37 new regressions bring the full suite to
7,631 units / 350 files and Stage 07 to 158 cases. One full live batch passes
105 cases / 117 scenarios without skips. All 17 offline examples, 18 retained
scripted comparison cases and public ESM/CJS/AMOS checks pass. Strategy module
coverage is 97.59% lines / 92.01% branches / 100% functions; integration code is
outside that percentage scope.

The reused comparison completes 12/12 cases per strategy with 24/24/36 model
attempts and 12 source reads each. Estimated model costs are $0.14400 / $0.14954 /
$0.15373; helpers are included, provider probes/earlier pilots/external fees are
excluded, and caching is uncontrolled. These are regression observations, not
fresh held-out quality evidence or general savings claims. See the
[corrective record](evaluations/STAGE_07_CORRECTIONS_VALIDATION.json) for actual
usage, prior failed regressions, uncertainty and unchanged compatibility.


The Stage 05 regression gate improves the comparison example's failed-selector
feedback with up to eight exact raw notes keys from that agent's own memory. It
exposes no source values or receipt IDs as proof; the model must still read a valid
source and satisfy the unchanged exact-answer/account/status/no-write/no-repeat
checks and call/output limits. Main/helper comparison sampling is now explicitly
temperature zero, recorded in reports. Earlier pilots used vendor-default sampling
and different recovery feedback; they are historical functional evidence, not
matched quality/cost trials. A source-lookup failure remains a failed predicate.

The Google compaction provider probe explicitly requests a 128-token thinking
budget and temperature zero through the existing helper profile. Its output cap
remains 4096, and exact source/account/status, no-repeat, one-repair and injected-empty
recovery checks remain enforced. Request capture verifies the thinking setting;
provider-default reasoning is not assumed disabled by `enabled: false`. This probe
setting is separate from the held-out comparison configuration and does not change
production helper defaults or claim general quality/cost benefits.

## Native history and plugin composition (Stage 16A)

Use `new ContextCompactionStrategy({ plugins: 'auto', history: 'native' })` via the
existing `context.compactionStrategy` instance field for independent reduction
controls. This is not a new StrategyRegistry name. It can run plugin-only,
native-only, combined or neither reductions; turning reduction off keeps normal
plugin features/tools. Native policy can summarize older user and acknowledged
settled action exchanges, with exact scoped source archival and recent-tail
protection. It uses the main model/connector, not the configured summary helper.
Masking/structured-summary and algorithmic retain their existing behavior. Read
[Native Context Compaction](NATIVE_CONTEXT_COMPACTION.md) before selecting it.
