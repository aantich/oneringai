# Model tasks and purpose-specific helpers

Stage 06 adds optional helper roles and shared, process-local model budgets. This
work is on the `version2` development branch; no package release is claimed.
Existing agents continue to use their configured main model. Omitting
`modelExecution` and per-call `modelTask` preserves existing behavior and adds no
helper calls, tools, prompt content, or accounting task.

## Configure explicit roles

Create named connectors using the normal host credential and account scope. The
following assumes `openai-main` and `openai-helper` have already been registered:

```typescript
import { Agent, ModelTask } from '@everworker/oneringai';

const agent = Agent.create({
  connector: 'openai-main',
  model: 'gpt-4.1',
  modelExecution: {
    maxOutputTokensPerCall: 256,
    helpers: {
      extractor: {
        connector: 'openai-helper',
        model: 'gpt-4o-mini',
        maxOutputTokens: 256,
        instructions: 'Extract the exact source identifier into answer.',
      },
    },
  },
});

const task = new ModelTask({
  limits: { maxCalls: 4, maxTokens: 3_000_000, deadline: Date.now() + 60_000 },
});
try {
  const extracted = await agent.invokeHelper<{ answer: string }>('extractor',
    context => `Source identifier=ALPHA_6. Input allowance=${context.maxInputTokens}.`, {
      modelTask: task,
      schema: {
        type: 'object',
        properties: { answer: { type: 'string' } },
        required: ['answer'],
        additionalProperties: false,
      },
    });
  await agent.run(`Use this identifier: ${extracted.value.answer}`, { modelTask: task });
  console.log(task.snapshot().totals);
} finally {
  agent.destroy();
  task.destroy();
}
```

Helpers are stateless, non-streaming, text-only model calls. Supported roles are
`compactor`, `extractor`, and `verifier`. They do not inherit history, tools,
native tools, provider continuation IDs, signed reasoning, or the main agent's
mutable state. `agent.tools === agent.context.tools` remains true. Helpers bypass the main Agent/context LLM hooks and execution events; inspect their
ModelTask records or the returned result. A helper is
never called automatically by a normal `run()` merely because it is configured.

The connector and capabilities are resolved before the optional packet-builder
callback runs. It receives frozen connector/model/input/output allowances. The
builder should select and redact evidence using trusted host policy; it must
observe the host's cancellation rules for any independent work it starts. A plain
string is also accepted. Passing native provider items or opaque state fails.
The registry checks known active models/vendor identity and reasoning or extended-thinking support;
custom providers may supply their own capacity for an unregistered model.
Scoped connector lookup cannot fall back to a globally available account.
Anthropic thinking modes and fixed token budgets are validated against the existing
provider rules before a packet builder runs. A fixed thinking budget must be at
least 1,024 tokens and smaller than the helper output allowance.

## Options and defaults

| Surface | Options and behavior |
| --- | --- |
| `modelExecution.helpers[role]` | Named `connector`, `model`; optional `instructions`, `thinking`, `temperature`, `maxInputTokens`, `maxOutputTokens`, `dataHandling`, `requireNativeStructuredOutput`, `allowContextTransfer`, and `priceBound`. |
| Helper output | Defaults to 512 tokens. `invokeHelper` can request a tighter `maxOutputTokens`. It cannot increase the role cap. |
| Helper input | Estimated packet, instructions and schema must fit the configured allowance and the resolved helper window, reserving output space. Estimates are not provider tokenization guarantees. |
| `invokeHelper(role, input, options)` | Required host-supplied synchronous JSON `schema`; optional `validationSchema`, `modelTask`, `signal`, `parentInvocationId`, `maxOutputTokens`, and `maxRepairAttempts` (0 or 1; default 1). Returns `{ value, response, invocationId, taskId }`. |
| `modelExecution.limits` | Optional per-execution defaults: `maxCalls`, `maxTokens`, `maxCostUSD`, absolute Unix-millisecond `deadline`. No limits are implicit. |
| `modelExecution.maxOutputTokensPerCall` | Optional positive aggregate cap for main calls, including repair and wrap-up. Google/Vertex `generationConfig.candidateCount` multiplies the per-candidate output request for this check. If no explicit per-candidate limit is supplied, divide the aggregate cap by count and round down. Explicit per-candidate limits and candidate count are preserved; requests above the aggregate cap fail before dispatch. Omission preserves provider defaults. |
| Per-call `modelTask` | Supported by managed/direct run and stream, explicit rollover, and external execution. A supplied task's limits take precedence over per-execution defaults; share the same object to share a budget. |
| `modelExecution.priceBound` / helper `priceBound` | Trusted deployment upper input/output rates per million tokens. Overrides inferred registry bounds for that model purpose. |
| `customProviderAttempts: 'single'` | Host attestation that an injected provider makes exactly one attempt per invocation. Required for hard task limits when physical attempts cannot be instrumented. |

Reasoning effort and structured-output requirements are capability-checked. Provider
reasoning defaults still apply when its API has no effective disable mapping;
`thinking: { enabled: false }` does not promise zero reasoning tokens on every
model. Prefer a tested model and adequate output cap. Helpers use their thinking
configuration independently from main-call vendor options. The Gemini 2.5 Flash
compaction probe explicitly selects `{ enabled: true, budgetTokens: 128 }` and
temperature zero within its unchanged 4096-token output cap; request capture
verifies that setting. This is a tested probe configuration, not an automatic
production override or a zero-reasoning promise. Helpers use the existing
native JSON-schema support where available, otherwise the prompt fallback. Both
paths validate the returned value locally with Ajv, including formats. Each helper
invocation owns its compiler through its bounded repair; schema IDs and caches
are isolated from other invocations. Local schema references work; schemas from
previous helper calls are not an implicit reference registry. Native
providers support different schema subsets; the provider may reject an otherwise
locally valid schema. Use a small portable object schema for cross-provider work.

Optional `validationSchema` adds stricter local JSON-schema requirements while
keeping `schema` as the portable native response format. Both must pass; this
cannot weaken the original schema. The additional constraints appear as prompt
guidance and are checked inside the same zero-or-one repair allowance. They do
not add another retry loop. Both schema roots are compiled/snapshotted before the
packet builder, with independent IDs/references, and released after invocation.
Invalid schemas fail before packet construction or dispatch. Guidance and repair
must fit the existing helper input/call/token/deadline limits.

```typescript
const result = await agent.invokeHelper('extractor', 'Extract the source identifier.', {
  schema: {
    type: 'object', properties: { answer: { type: 'string' } },
    required: ['answer'], additionalProperties: false,
  },
  validationSchema: {
    type: 'object', properties: { answer: { type: 'string', minLength: 1 } },
  },
  modelTask: task,
});
```

Automatic structured compaction uses this path to reject all-empty sections and
blank/overlong entries before marking helper output valid. Its existing repair
gets the retained source, and the ledger records the rejected generation and
repair separately. Standalone summary callbacks retain their existing one-call
transaction/fallback contract. See [Context Strategies](CONTEXT_STRATEGIES.md).


Helpers request no explicit prompt cache, and inherit the host data-handling policy.
A helper profile cannot relax an explicit parent `false` restriction. Connector
selection is trusted host configuration, never model-controlled. These controls
do not claim to change a provider's contractual retention or implicit caching.

## Budgets, reservations and prices

`ModelTask` atomically reserves capacity before each model attempt within one
process. Concurrent callers cannot spend the same remaining reservation. Physical
SDK retries and provider-internal continuation requests each require admission;
repair and wrap-up are separate logical invocations. Default SDK retries remain
unchanged. Exhaustion stops the next dispatch with `ModelBudgetExceededError`.

Token reservations use the provider's full resolved input capacity plus the output
bound, rather than trusting a local prompt estimate. A small request to a large
window model therefore needs a large temporary allowance. Usage includes all
reported candidates. For Google GenerateContent/Vertex, reservation is
input capacity plus candidate count times the per-candidate output limit. Counts
and multiplication must be positive safe integers. A three-candidate request
with `maxOutputTokens: 128` needs an aggregate configured cap of at least 384,
if a cap is configured. Increasing candidate count cannot evade token/cost limits.
Known settled usage refunds unused token capacity; call slots are never refunded after dispatch.
Failed or cancelled attempts without usage retain their worst-case reservation.
Legacy SDK adapters can normalize absent wire usage to zeros; an all-zero
transport report is conservatively unknown in the task ledger, preserving old
public response/event shapes. Explicit host external zero-usage reports remain known.
Provider preflight failures that never dispatch refund their reservation. Reported
cache and reasoning tokens are subsets in task snapshots, not extra tokens to add
a second time. Google GenerateContent (also used by Vertex) reports visible output
and thinking separately in its legacy response/events. The ledger normalizes
these into inclusive output tokens for cost, refund and helper output checks,
while preserving those public response/event fields. Interactions and providers
with inclusive output counts are not incremented again.

`maxCostUSD` bounds **estimated model token charges under the selected upper
rates**, not an invoice or all workflow spending. Known registry text rates provide
a conservative reservation across represented cache/long-context/processing tiers.
For a different deployment, tier, discount or premium, supply a reliable host
`priceBound`; unknown bounds fail admission. Settled budget charges retain upper
rates even if the registry's cost estimate is lower. External tool/service fees,
taxes and account-specific pricing are outside this accounting. A hard model-cost
limit rejects provider-hosted native tools because their fees are not bounded here.
This includes raw tool overrides in supported vendor request-option containers
(`tools`, MCP/native-tool aliases and nested Google configuration). Raw tool
overrides are conservatively unsupported under this ceiling; use typed local
tools when appropriate. Pricing overrides in these containers require an explicit
host price bound. Omitting the monetary ceiling preserves raw-option behavior.

Tracked calls capture request records/arrays before admission, including nested
vendor configuration. Checks and provider dispatch use that same view, even when
the caller reuses or mutates its configuration during SDK setup. Live signals,
connector registries, functions and opaque SDK values keep their identity; these
are host-controlled capabilities. Untracked calls preserve their existing behavior.

Unknown model prices are `null`, not zero. With call/token/deadline limits alone,
unknown pricing is allowed and remains visible. Returned usage and registry prices
are observations/estimates; they cannot prove the amount ultimately billed.

## Inspect usage and failures

`task.snapshot()` and `agent.getModelUsage()` return detached metadata snapshots:
task/parent/invocation IDs, purpose, generation/repair/wrap-up phase, selected
connector/model, transport attempts, HTTP status, usage, estimated model cost and
validation result. They contain no prompts, headers, credentials or raw errors.
Purpose is a label, not permission or a routing instruction. The default parent
is the task ID; explicit helper parent IDs can link a host workflow.

Use `totals.totalTokens` and `knownModelCostUSD` as **known subtotals** alongside
`unknownUsageInvocations`, `unknownCostInvocations` and `unknownChargeAttempts`.
`chargedTokens`/`chargedCostUSD` include outstanding conservative reservations and
may exceed known actual usage. Aggregate provider usage is counted once per logical
invocation; failed retries may still have unknown charges. A response received
successfully can separately have `outputValidation: 'failed'`.

Malformed JSON or schema-invalid values receive at most one tool-free repair,
charged to the same task. The repair retains the original selected task/evidence
packet alongside the invalid answer and error; the packet builder runs only once.
The complete repaired input must fit the helper allowance. If it cannot fit, the
helper fails before another dispatch and does not trim evidence or copy additional
history. Refusal, incomplete responses, unexpected tool requests,
oversize packets and exhausted budgets fail clearly. Helper tools are never executed.
`HelperOutputError` reports failed output validation. There is no implicit model
escalation: the host may invoke a separately configured role with the same task,
or fail the workflow. Schema validation does not establish semantic truth.

The task's `signal`, per-call `signal`, `task.cancel()` and agent destruction
stop admitted work where supported. `agent.cancel()` also stops managed execution
and standalone helpers; direct calls use their explicit signal or shared task. An uncooperative provider may
settle late; its usage remains attributed to the original task and is never
delivered to later agent context. Already emitted stream text cannot be withdrawn.
An early stream exit without final usage remains unknown and conservatively charged.
When terminal usage arrived before a later iterator error, cancellation or early
exit, its known charge is retained once, alongside the failed/cancelled outcome.
Unknown retry charges remain reserved; conflicting terminal reports fail explicitly.

## Explicit compactor integration

Configure `helpers.compactor` and call `agent.rolloverContext({ modelTask: task })`
between executions. The existing rollover transaction and safe text formatter
build the packet. A compactor on another connector requires
`allowContextTransfer: true`, explicitly authorizing that history transfer. Native
reasoning/continuation items remain excluded. The formatter is a bounded continuity
view, not a lossless multimodal/native-result export. A custom rollover summarizer
continues to take precedence; without a helper, the original main-model summarizer
continues to work. A no-op rollover makes no model call.

The rollover recipe above remains explicit and between executions. Stage 07 also
provides opt-in [structured summary strategies](CONTEXT_STRATEGIES.md) that share
the active ModelTask during bounded pre-call preparation. Configuring a compactor
alone keeps the algorithmic default. The main model stays fixed; the new bounded
functional comparison does not establish general quality preservation or cost savings.

## Ownership, persistence and support boundaries

Without a supplied task, enabling `modelExecution` creates a separate owned task
for each managed execution, direct call, or helper, including a helper started
while a main execution is running. Explicitly pass the same `modelTask` to share
admission and lifetime. Main completion cannot cancel an independent helper. The framework
destroys owned tasks after use while retaining their diagnostic snapshot. With a
shared task the host owns cancellation/destruction. Retain the task object when
late diagnostics matter. A snapshot can be stored for diagnostics, but cannot be
loaded to restore budget authority. Saved context/old AMOS sessions remain compatible;
the host must reapply static role configuration after hydration. Tasks, credentials
and runtime authorization are never portable agent-package/session fields.

| Execution path | Stage 06 boundary |
| --- | --- |
| Native OneRingAI managed/direct run and stream, repair, wrap-up, explicit helpers/rollover | Integrated task admission and purpose usage. |
| OpenAI, Anthropic, Google, Vertex, DeepSeek adapters; inherited Grok/generic OpenAI adapters | SDK custom fetch observes physical attempts when called through the task boundary. OpenAI/Anthropic/Google have live Stage 06 evidence; others have local regression coverage only. |
| Injected provider | One logical provider-boundary observation; hard limits require the host's single-attempt attestation. Hidden retries are otherwise unobservable. |
| `beginExternalExecution({ modelTask })` / `recordExternal` | Observation only. Final usage attributed once by stable ID; conflicting replays fail and mixed/unknown pricing tiers remain unknown. Observed uncertainty survives final metadata/count snapshots; contradictory or composite mode/speed/tier combinations cannot be priced with one registry multiplier. Missing/empty/metadata-only reports and incomplete core counts remain unknown, including for failed executions. Explicit input/output zero counts are known zero. Incremental input/output counts can be combined; final count fields override their accumulated counterparts. Legacy external response defaults remain intact. `recordExternal` accepts optional `status: 'succeeded' \| 'failed' \| 'cancelled'` (default `succeeded`); Agent completion supplies its actual outcome. The external runtime/host owns admission and internal attempts. |
| Raw `getProvider()` calls, batches, media APIs, standalone capabilities, Codex SDK internals | Outside automatic task admission. No distributed/durable budget or provider-native state migration. |

## Run the examples and AMOS

Build first. Both examples default to deterministic offline execution:

```bash
npm run build
npm run example:purpose-models
npm run example:shared-budget
# Explicit opt-in: three or more billable OpenAI requests, OPENAI_API_KEY in .env.
npm run example:purpose-models -- --live
# Fourteen live cases across OpenAI, Anthropic and Google; all three keys required.
npm run test:models:live
```

The [purpose example](../examples/purpose-specific-models.ts) demonstrates
extract/main/verify with different windows, then cleans up all owned resources.
The [budget example](../examples/shared-run-budget.ts) demonstrates concurrent
exhaustion/refund, idempotent external observations and unknown pricing. Synthetic
offline answers/usage and the small live marker checks make no quality or savings
claim.

AMOS is a source-checkout application; its walkthrough and app guide are repository
resources. AMOS `/helpers` explains expected requests before configuration. Use
`/helpers set extractor <connector> <model> [effort]`, then
`/helpers run extractor <text>` and `/helpers usage`. Set a compactor and use
`/helpers compact` for explicit rollover; selecting it authorizes history transfer
to that connector. `/helpers budget <calls> <tokens>` sets per-operation defaults.
`/helpers off [role]` removes a role; full `off` disables tracking too. Configuration
makes no model calls, preserves the session, and stores connector names rather
than keys. Each explicit helper may make one call plus one repair. AMOS does not
aggregate independent commands into one host-shared task. See the
[AMOS guide](../apps/amos/README.md#helper-models-stage-06).

## Native compactor accounting (Stage 16A)

`ContextCompactionStrategy` uses the main connector/model for native compaction.
The local `helpers.compactor` remains the explicit semantic-summary/rollover option.
Native model invocations have purpose `compactor` and share the active ModelTask;
provider model discovery/input counting are auxiliary I/O and do not consume
generation attempts. Discarded/no-reduction results still count. Anthropic native
usage is read from compaction iterations; missing/partial usage stays unknown.
OpenAI's compact endpoint cannot honor `maxOutputTokensPerCall`; that combination
is rejected. Use explicit conservative task call/token/cost/deadline bounds and
a main-only `before:llm` cap if needed. Provider counts are capacity provenance,
not billing. Read the [native recipe](NATIVE_CONTEXT_COMPACTION.md) for reservation,
persistence and cancellation boundaries.

Anthropic native output keeps the main thinking mode/budget. The default allowance
is 4096 tokens for adaptive/disabled thinking, or the resolved fixed budget plus
4096 summary tokens, bounded by model output capacity. Explicit output caps and
`maxOutputTokensPerCall` are respected rather than silently enlarged. Known fixed
budget/cap conflicts fail before archival; actual native wire caps, source headroom
and ModelTask reservations use the same selection. Internal streaming supports
large valid caps and retains iteration usage when a summary is unusable. Main
generation limits/settings and helper routing remain unchanged.


## Optional main-model routing

[Stage 14A routing](./MODEL_ROUTING.md) optionally chooses the managed execution's
main connector/model before preparation. Helper roles remain static. The selected
model's capacity/output/price bounds feed the same active ModelTask; selection,
repair, retries and compaction do not reset its allowance. Automatic helper context
transfer checks use the selected main connector and inherited restrictions.
Routing diagnostics identify the decision; ledger invocations identify actual calls.
