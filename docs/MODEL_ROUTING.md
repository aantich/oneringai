# Managed model routing

Stage 14A adds optional named routes to the existing Agent. Configure a host rule,
or choose a route explicitly for a managed `run()` or `stream()`. One execution
keeps its selected connector/model through tool iterations, provider retries,
bounded recovery, JSON repair and native compaction. The Agent's configured
`model`, `connector` and `context.model` remain its defaults.

**Second corrective pass (2026-10-23):** Repaired replay items retain their admitted
owner, rejected resumes retain their original task, and structured suspension
finalizes before checkpoint/publication. See the
[second review and completion record](./designs/STAGE_14A_SECOND_REVIEW_AND_FIX_PLAN.md)
and [corrective validation](./evaluations/STAGE_14A_SECOND_CORRECTIONS_VALIDATION.json).

The [review/fix plan](./designs/STAGE_14A_REVIEW_AND_FIX_PLAN.md) records the
three corrective changes and their validation. Saved opaque state keeps final
owner checks independently of whether routing is configured.

This capability is available on the development branch. Package publication is a
separate release step. [Delivery and validation](./designs/STAGE_14A_IMPLEMENTATION.md).

## Start with a small host rule

Create named connectors with `Connector.create()` first. Select tested model IDs
from their vendor's registry. These variables refer to your own configured
connector names, model IDs, tools and existing context configuration:

```typescript
import { Agent, ModelTask } from '@everworker/oneringai';

const agent = Agent.create({
  connector: primaryConnector,
  model: mainModel,
  tools: existingTools,
  context: existingContext,
  modelExecution: {
    routing: {
      routes: {
        fast: { model: fastModel },
        specialist: {
          connector: specialistConnector,
          model: specialistModel,
          allowContextTransfer: true,
        },
      },
      select: ({ hints }) => hints.taskType === 'lookup' ? 'fast' : 'default',
    },
  },
});

const task = new ModelTask({ limits: { maxCalls: 8 } });
try {
  const response = await agent.run('Find the confirmed order status.', {
    routing: { taskType: 'lookup' }, modelTask: task,
  });
  console.log(response.output_text, response.routing);
  await agent.run('Explain the verified result.', {
    routing: { route: 'default' }, modelTask: task,
  });
  console.log(task.snapshot());
} finally {
  agent.destroy(); task.destroy();
}
```

The host supplies `taskType` and `phase`; the library does not classify task prose
or call a hidden router model. The implicit `default` route always uses the
configured Agent connector/model. An unknown category should normally map to
`default`. Route names are configuration keys, not connector names.

For explicit routing only, omit `select`. Run with `{ routing: { route: 'fast' } }`
to use a named route, `{ routing: { route: 'default' } }` to select the default,
or `{ routing: null }` to bypass the policy and use that default. Explicit choice
bypasses the selector. Without a policy or explicit routing option, legacy
execution and response/event shapes remain unchanged.

## Configuration and bounded selection

`ModelRoutingConfig` has:

| Option | Default | Contract |
|---|---|---|
| `routes` | Required map | At most 16 alternative profiles. `default` is reserved. |
| `select(context)` | Absent | Return a route string or `{ route, reason? }`, synchronously or asynchronously. |
| `fallback` | `default` | One fallback when the selector throws or times out. |
| `timeoutMs` | `1000` | Positive integer; bounded by the active task deadline/cancellation. |
| `sticky` | `run` | `phase` optionally pins a dispatched route across an explicit shared task/phase. |

Each `ModelRouteConfig` requires `model` and optionally supplies `connector`,
`thinking`, `temperature`, `maxOutputTokens`, `priceBound`, `dataHandling` and
`allowContextTransfer`. No alternative connector means the existing main
connector. Host per-call thinking/temperature overrides take precedence. A route
output cap tightens the global `maxOutputTokensPerCall`; its price bound belongs
to that route and does not inherit unrelated deployment prices from the main
model. Inherited false data-handling permissions cannot be relaxed by a route or
request hook.

The selector receives frozen, bounded `hints`, preliminary `candidates`, optional
`previous` route identity, and `signal`. Each candidate exposes only route,
connector name, model, `eligible` and generic `reasons`. Preliminary eligibility
checks accessible connectors, vendor/lifecycle, transfer permission and known
protocol ownership. The selected provider's actual capabilities, request shape,
capacity and budget still require final validation. Candidate eligibility does
not promise that arbitrary request content fits a model.

The packet contains no automatic transcript, tool arguments/results, credentials,
or mutable Agent/Connector objects. A host closure can access its own data;
keep those accesses scoped. If the selector deliberately invokes an LLM, account
for that call explicitly with the same `ModelTask`. A selector timeout aborts its
signal and ignores late decisions; it cannot stop synchronous JavaScript or
undo arbitrary external effects initiated by host code.

Route names are 1–64 characters; prototype keys are reserved. Hint fields allow
at most 128 characters and a reason at most 512. Route maps and options are copied
at construction/admission. Policies and credentials remain host configuration.

Selection occurs after acquiring the execution slot, before committing new input,
preparing context or reserving the main model call. Unknown/malformed routes,
unauthorized transfers, incompatible state/capabilities, request-fit errors,
budget exhaustion and cancellation fail explicitly. They do not trigger routing
fallback. An invalid fallback also fails. Provider failure keeps the ordinary
provider's bounded retry behavior; routing does not replay a run or an external
action on another model.

## Phase continuity with an explicit ModelTask

```typescript
// On an Agent configured with routing.sticky: 'phase':
const task = new ModelTask({ limits: { maxCalls: 10 } });
try {
  await agent.run('Look up the first source.', {
    modelTask: task, routing: { taskType: 'lookup', phase: 'gather' },
  });
  await agent.run('Check another source.', {
    modelTask: task, routing: { taskType: 'other', phase: 'gather' },
  }); // Uses the route actually dispatched during gather.
  await agent.run('Reason over the observations.', {
    modelTask: task, routing: { taskType: 'analysis', phase: 'decide' },
  }); // New phase selects again.
} finally { task.destroy(); }
```

A pin belongs to this Agent and this exact host-owned `ModelTask` object and the
latest nonempty phase. Separate tasks/Agents do not inherit it. Explicit overrides
update the pin after dispatch. Changing/omitting the phase clears continuity;
returning to an old phase does not resurrect an earlier pin. Failed admission
does not pin a route. Pins, selector callbacks and task authority are not saved
in sessions. The default `sticky: 'run'` selects independently for each execution.

Background tools and suspended routed executions retain their original binding
and task; automatic followups do not select a new model or reset the allowance.
Complete/cancel originating async work before unrelated routed input. The existing
`hasPendingAsyncTools()` semantics remain; `hasPendingAsyncTools(true)` also checks
queued current deliveries when hosts need a safe replacement decision. Cancellation
does not establish whether an external write happened. Inspect its actual outcome.

A failed resume keeps its original route, effective options and task even if
preparation, a hook, cancellation admission or a call/token/cost/deadline limit
rejects the attempt. Repeating the event cannot acquire a fresh allowance. A
successful completion releases the origin, including when a stream consumer stops
at its terminal event. To abandon pending work deliberately, the host can call
`agent.cancel(reason)` before starting genuinely new work. This releases process-local
task authority; it never undoes an external action or erases its observation.

For structured `run()`, suspension wrap-up is parsed/repaired before saving the
session/correlation and emitting `execution:suspended`. Returned and saved answers
therefore agree. If required finalization fails after registration, the library
saves the actual observation and correlation without publishing suspension success.
The existing optional snapshot metadata contains
`suspensionFinalization: { status: 'failed', correlationId, ...sessionRef }`. This is
a recovery diagnostic, not a validated answer or restored budget/route authority.
Inspect the receipt and repair the failed budget/storage/configuration explicitly;
never register the wait again to repair bookkeeping. When both finalization and
its recovery checkpoint fail, `AggregateError.errors` retains both errors and
`cause` retains the original. Session/correlation write failures never emit success;
retain in-memory observations and repair the backend before teardown. A failing
backend cannot guarantee restart durability. Session loading still does not restore
callbacks, task budgets or host authorization. Streaming keeps its no-repair contract.

## Context plugins, helpers and native compaction

Routing uses the same context, plugins and ToolManager. It prepares against the
selected model's capacity, retains task state and scoped evidence, and runs final
fit/authority/protocol checks before dispatch. `lastPreparation.model`, when
present, reports the selected preparation model. Do not pre-prepare the turn to
implement routing. `agent.tools === agent.context.tools` remains true.

`ContextCompactionStrategy` still gives plugin reduction and native history
compaction peer settings. A selected native adapter compacts/counts with the
selected route and charges `purpose: 'compactor'` to the active task. Its source
freshness guard composes with route/authority guards, including budget observers.
No parallel compaction policy or alternate plugin pipeline is introduced.

Signed/encrypted reasoning, native continuations and other provider-bound replay
state require their exact connector, model, endpoint and host principal. General
transfer permission does not make those items portable. Plain transcript data can
move only to an explicitly authorized connector/account. To use a different model
after opaque state exists, keep its compatible route or deliberately start a fresh
context under host control. A default opt-out can consequently be rejected even
though it is a valid route name.

These checks also apply to state first observed during JSON repair/reformat, with
or without routing. Ordered top-level reasoning/compaction and persistent signed
message state survive replacement, snapshots and continuation. A captured response
boundary rejects replacement if unrelated assistant data arrived during repair;
it never overwrites another observation. Portable-only repairs preserve legacy
model hooks. The public content-only `replaceLastAssistantResponse()` helper keeps
its existing behavior; managed protocol replacement is internal. Journal adapters
keep their existing optional replacement contract, appending ordered correction
items where replacement is unavailable; snapshots remain the managed replay source.

Session checkpoints may include an optional credential-free origin binding. Native
checkpoint restore resolves its exact owner only among the host's configured,
authorized default/routes and verifies the existing native/evidence scope and
integrity. It does not trust saved route policy as permission. Legacy snapshots
remain loadable; unknown opaque origins are conservatively tied to the default.
Configure the same stable owner/evidence storage and authorized native route before
`loadSession()`. `Agent.saveSession()` returns `void`; obtain its ID separately
with `getSessionId()`.

Explicit between-execution `compactContext()` and `rolloverContext()`, direct
calls and helpers keep their existing configured defaults/ownership. A native
checkpoint owned by an alternative route can be continued by a managed run that
selects that owner; an idle default compaction cannot silently switch it.
Configured helper roles remain static. Automatic compactor helper transfers are
checked against the currently selected main connector and inherited restrictions.

Native support is model/provider specific. OpenAI's on-demand native endpoint
does not accept a hard output-token cap; a global/route hard native cap is rejected
before dispatch. Bound main output separately with existing main-call hooks when
using that endpoint. Anthropic native source counting uses the same compaction
mode as execution, including an exact terminal assistant body with whitespace.
No source is trimmed or amended to satisfy generation-prefill validation.
See [native compaction](./NATIVE_CONTEXT_COMPACTION.md).

Managed JSON repair keeps the selected route, active task, admitted task evidence
and host instructions. The repair remains tool-free and fit-checked; it does not
start a second context preparation. Provisional stream text cannot be retracted;
the existing non-streaming-only JSON repair boundary remains.

## Cross-provider settings and support boundaries

Other connectors/accounts require `allowContextTransfer: true` on the profile,
even with the same vendor. Connector registry and tenant/owner authority remain
host-controlled. A changed principal, registry, connector identity, endpoint or
request-hook model invalidates the selected binding before dispatch.

If main `vendorOptions` are configured, a different-vendor route requires explicit
compatible per-call `vendorOptions` (`{}` clears inheritance). Those options are
not blindly merged across vendors. Provider-native tools, reasoning, images,
files, strict caching and known capacities are validated for the selected model.
Routing does not imply that two providers support identical request settings.

Routing applies to managed `run()`/`stream()`. `runDirect()`/`streamDirect()`,
external SDK drivers, Realtime, helper calls and explicit maintenance keep their
existing owners. An explicit unsupported routing option on direct/external entry
points is rejected; merely configuring Agent routing does not affect them.
There is no learned classifier, automatic confidence escalation, mid-run switching,
cross-model failover or bounded specialist delegation in 14A. Stage 14B requires
its own approval.

## Diagnostics and actual usage

`response.routing`, the existing `RESPONSE_COMPLETE` stream event's optional
`routing`, and `agent.getRoutingDiagnostics()` expose `decisionId`, `executionId`,
requested/selected route, connector/model, `source`, optional bounded reason,
selector failure kind, and `selectionMs`. A getter returns a detached copy.
Sources distinguish `default`, `policy`, `explicit`, `sticky`, `fallback` and
`disabled`. A selection diagnostic alone does not prove dispatch or task success.

Use `task.snapshot()` or `agent.getModelUsage()` for actual per-model main/helper/
compactor calls, repairs/retries, known token costs, reservations and unknowns.
Selection wall time is not an end-to-end latency or billed-cost estimate.
Registry costs remain estimates; external fees are excluded. All calls in an
explicit shared task consume its original limits; routing does not grant extra
tokens, cost, calls or time. See [model tasks/helpers](./MODEL_TASKS_AND_HELPERS.md).

The live cost gate also exposed an ignored Google opt-out: explicit
`thinking: { enabled: false }` now sends `thinkingBudget: 0` for Gemini 2.5 Flash,
Flash-Lite and their preview aliases through GenerateContent (the shared Vertex
converter too). Omitting thinking keeps provider defaults. Existing explicit raw
vendor thinking configuration/levels retain their precedence; Pro, 3.x, image,
unknown models and Interactions behavior are unchanged. Google documents the
[model-specific zero-budget opt-out](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en).
The pilot keeps its original exact-answer and minimum cost-reduction gates;
it is still a bounded functional comparison, not a general savings guarantee.

## Examples, AMOS and validation

Build first, then run:

```bash
npm run example:model-routing
npm run example:routing-context
npm run example:routing-suspension
npm run example:routing-suspension -- --failed-finalization
npm run example:amos-routing
```

These default to deterministic synthetic providers, use no keys/network, assert
their route/lifecycle contracts and destroy agents/tasks/temp files. The context
example combines evidence, memory and synthetic native history with a rejected
incompatible switch. The AMOS example exercises real commands, saved JSON rules,
run/stream decisions and opt-out. Synthetic usage demonstrates accounting only.

`npm run example:model-routing -- --live=openai` (or `anthropic`/`google`) loads
`.env`, requires that provider's key, and makes bounded billable calls. It prints
the same decision/task diagnostics and cleans up. The tested model pairs are in
`examples/model-routing/fixture.ts`; they are functional fixtures, not general
model recommendations.

AMOS commands:

```text
/routing set fast my-connector model-id
/routing rule lookup fast
/routing use auto
/routing hints lookup gather
/routing
/routing use default
/routing off
```

Append `allow-transfer` to `set` for an explicitly authorized other connector.
`/routing use fast` forces an alternative; `use auto` restores the table policy.
No configuration command invokes a model. JSON tables are reconstituted as host
rules; callbacks are not serialized. AMOS displays actual selected routes beside
responses and preserves helpers when disabling routing. Changing live configuration
requires an idle, replaceable agent; incompatible native checkpoints remain protected.
AMOS hints alone do not create a shared task/phase pin across turns.

`npm run test:model-routing:live` explicitly enables the provider contract suite
and a small fixed six-task comparison of default-only, fast-only and routed modes
for each of three vendors. The rule, inputs and exact quality oracles are fixed;
main/routed quality must match all six, and routed registry token cost must improve
by at least 5%. Uniform output schemas/settings apply across modes. Failed calls,
repairs and router wall time remain included. Fast-only errors are measured rather
than silently discarded. This is a functional pilot, not a blind benchmark or a
general quality, cost or latency claim. [Validation evidence](./evaluations/STAGE_14A_VALIDATION.json)
records the actual run and limitations.

The initial delivery pilot on 2026-10-22 observed (historical; corrective rerun snapshots are in the [corrective evidence](./evaluations/STAGE_14A_CORRECTIONS_VALIDATION.json)):

| Provider fixtures | Main / routed exact successes | Fast-only exact successes | Routed token-cost reduction versus main |
|---|---|---|---|
| OpenAI | 6/6 and 6/6 | 5/6 | 30.4% |
| Anthropic | 6/6 and 6/6 | 6/6 | 32.8% |
| Google | 6/6 and 6/6 | 6/6 | 10.3% |

These estimates describe only those six synthetic tasks and tested model pairs.
The OpenAI fast-only miss was `41 - 15` answered as `25`; the routed rule kept
arithmetic on the main model without using an answer oracle. Full snapshots retain
actual calls/usage, measured wall time and comparison failures. They do not establish
general quality equivalence, production savings or a latency guarantee.

## Suspended runs and native alternatives

A suspended routed `run()` retains its selected connector/model, ModelTask and
effective run options. Resume with ordinary `run(eventText)`: the inherited format
also controls final JSON coercion, bounded repair and the host completion check.
Explicit supported resume options override originating values; existing data
prohibitions cannot be relaxed. A routing override or a different task cannot
replace the suspended execution's owner. Automatic async delivery uses the same
finalization path and does not consume a new selector allowance.

Local JSON coercion validates parseability, not full JSON Schema conformance.
The host predicate sees the final parsed/repaired candidate; configure it to check
actual scoped evidence. Streaming retains its existing no-repair boundary.
`npm run example:routing-suspension` demonstrates one synthetic wait, four model
calls including repair, and one resumed host check. It uses temporary session/
correlation storage and removes it during cleanup; no credentials are required.

Exact-owner guards apply to saved opaque state even when a restoring Agent omits
routing. Post-hook dispatch, reservation observers and tracked transport retries
retain the checks. Newly observed opaque output is tagged with the admitted
request's connector/model/endpoint/principal, including portable legacy runs that
use a supported model hook. Portable history alone still permits those overrides;
direct calls retain their separate owner. No new required session field is added.

With routing configured, native compaction binds after selecting a route. An
unused default can lack a native adapter: an explicitly permitted supported
alternative can still run and restore its exact native checkpoint. An unsupported
selected route fails before model generation or committing new input. Nonrouting
construction and idle `compactContext()` retain their existing configured owner
and adapter requirements. `example:routing-context` demonstrates this composition
with the same context plugins and ToolManager.
