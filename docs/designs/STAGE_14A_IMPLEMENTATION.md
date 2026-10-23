# Stage 14A — Managed model routing delivery

- Date: 2026-10-22; branch `version2`, baseline `cf87b4a` (`stage 16A`).
- Authorization: the user replied “proceed” after review of the
  [routing-first API](./STAGE_14_ROUTING_AND_DELEGATION_API.md).
- Scope: full 14A implementation, tests, examples, AMOS and documentation.
  Stage 14B, learned routing, mid-run switching, automatic cross-model replay,
  distributed scheduling, a breaking change and package publication are deferred.
- Status: **complete on branch; all S1–S3 corrections validated**.
  [Second corrective completion](./STAGE_14A_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-23)
  and [validation](../evaluations/STAGE_14A_SECOND_CORRECTIONS_VALIDATION.json).
  8,775 units / 385 files, 224 live tests / 13 suites across OpenAI, Anthropic and Google with no required skips, 39 offline modes and 202 public ESM/CJS controls pass.
  Original delivery and first corrective gates below remain historical; no release.
- Public recipe: [Managed model routing](../MODEL_ROUTING.md).
- Machine-readable results: [validation](../evaluations/STAGE_14A_VALIDATION.json).

## Delivered API

`ModelExecutionConfig.routing?: ModelRoutingConfig` adds named
`ModelRouteConfig` profiles and an optional bounded host `select` callback.
`RunOptions.routing?: ModelRoutingRunOptions | null` supplies `taskType`/`phase`,
an explicit route or default opt-out. The existing configured connector/model is
the reserved implicit `default` route. No selector is required for explicit-only
usage. Up to 16 alternatives; default selection timeout 1000ms and fallback
`default`; default stickiness `run`. The selector receives frozen bounded metadata
and a cancellation signal. It makes no implicit LLM call.

`ModelRoutingDiagnostics` is available through optional response/existing stream
completion `routing` and detached `Agent.getRoutingDiagnostics()`. Public route,
hint, decision/context/candidate/config/diagnostic types are exported from the root
and documented types surface. No new stream discriminant is introduced.

The binding uses one selected provider, connector, model, output/price/data profile
and active task throughout a managed execution. Tools/context/plugins remain the
same; `agent.model`, `.connector` and `.context.model` retain configured defaults.
Helpers, direct calls, explicit maintenance and external SDK loops keep their
existing owners. An explicit unsupported routing option on direct/external entry
points fails instead of being silently ignored.

Phase continuity is opt-in and scoped to Agent plus the exact shared ModelTask
and latest nonempty phase. A pin is recorded only at actual dispatch after budget
admission. Changing/omitting phase clears it. Async/suspended continuations retain
their originating route/task rather than reselecting or resetting the allowance.
Background structured completion retains its format and original evidence; its
per-run settings are cleared at settlement.

## Integration and guards

Selection happens under the Agent execution lease, before committing input,
preparing context or main-call reservation. Accessible connector, vendor/lifecycle,
transfer permission and known replay ownership guide candidate eligibility.
Selected provider capabilities, tools, modalities, reasoning, native/cache support,
capacity and the actual request remain subject to final validation.

Another connector/account requires `allowContextTransfer: true`. Signed/encrypted
reasoning, native continuations and other provider-bound state retain exact owner
identity. Scope, endpoint, connector registry and request-hook model/data handling
are guarded at dispatch. Inherited false data permissions cannot be relaxed;
cross-vendor settings require an explicit compatible replacement. Invalid routes,
ineligible state, cancellation and budgets fail explicitly. Selector exception or
timeout alone permits one configured fallback. Provider retries never reroute the
run or replay its external actions.

Selected capacity is passed internally to context preparation and final request
checks. `lastPreparation.model` is optional. Plugin contributions, protected task
state, durable evidence and the one shared ToolManager remain intact. The existing
plugin/native composition strategy compacts with the selected provider/model and
charges the same ModelTask. Its source guard is composed with routing and runs
after reservation observers, including physical retry dispatch.

An optional credential-free `providerStateBinding` checkpoint field records replay
origin. Native load can resolve its exact owner only among authorized routes
configured by the host and only with existing endpoint/principal/evidence/hash
proof. No callback, phase pin, task budget or transfer authority is restored from
saved policy. Legacy checkpoints remain supported. Proof-only restore does not
install a new live routing decision or bypass execution admission.

Two integration defects found through real provider validation are corrected:

- Managed tool-free JSON formatting/repair now retains the actual admitted task
  frame and host instructions when selective context/native history are absent.
  It stays on the same binding/task, preserves tool evidence, remains fit-checked,
  and does not start another context preparation. Native repair retains its
  protocol-aware formatting view.
- Anthropic native source counting now uses the same compaction operation mode as
  execution. This preserves a terminal assistant body, including trailing whitespace,
  without generation-prefill validation, trimming or synthetic source messages.

## Tests and examples

104 new unit cases cover configuration and metadata bounds; selector errors,
timeouts, cancellation, deadlines and late results; explicit/default/phase choices;
selected capacity, output/data/vendor restrictions; shared concurrent task
reservations; no failover; tool and structured repair; async ownership/budgets;
opaque checkpoint origin and native restore; source/scope drift; legacy/default
contracts; and AMOS JSON/configuration/rollback paths. The focused routing module
coverage gate reports 100% statements/lines/functions and 92.81% branches.

The full unit suite passes 8,688 tests across 382 files, with zero failed/skipped.
All 37 offline examples/modes and 182 ESM/CJS public controls pass, including the
existing preset, assembly and native controls. Root/AMOS build, source/app/example/
public consumer type checks, strict relevant tests, lint and API generation pass.
The final live gate passes 216 unique cases across 13 suites (full matrix plus the
complete 14-case accounting-suite rerun after its fixture correction). The validation
artifact records actual counts and logs; previous stage counts do not validate
this delivery.

New runnable examples:

- [`adaptive-model-routing.ts`](../../examples/adaptive-model-routing.ts): host
  rules, shared-task phase continuity, explicit default stream and opt-out.
- [`routing-with-context.ts`](../../examples/routing-with-context.ts): existing
  memory/evidence plus synthetic native history and exact compatible continuation.
- [AMOS routing](../../apps/amos/examples/routing-offline.ts): real runner,
  configuration persistence, `/routing` commands, run/stream diagnostics and off.

All default offline and clean up. Explicit live examples load `.env`, bound calls
and expose actual usage; synthetic accounting is labeled. The live suite checks
all three vendors, cross-provider portable text, native save/restore for OpenAI and
Anthropic, and controlled JSON repair with retained original evidence.

## Fixed functional pilot

Six fixed task inputs/oracles are separate from the routing rule: lookup uses
`fast`; other/unclassified work uses `default`. Each vendor compares fixed main,
fixed fast and routing under the same zero temperature, output cap and domain
schemas. Main/routed must each pass all six exact completion predicates; routed
registry token cost must improve by at least 5%. Fast-only quality is a measurement,
not assumed to be perfect. Actual calls, repair/failures, unknown usage/cost and
wall time are retained. No verifier supplies the answer or hides errors.

Development validation found underspecified output formats/too-small caps in the
initial protocol. The revised protocol was frozen uniformly before the final run:
integer/date/status forms reflect the task domain without supplying the oracle;
all six inputs, expected answers and the routing rule are unchanged. Earlier
diagnostic runs and the exact correction rationale are retained in the evidence.
The separate tool-transport contract requires its first read through a public host
hook, rather than treating prompt compliance as a transport guarantee. The exact
read count, result and selected model still have to pass.

This is a small fixed functional pilot, not a blind benchmark, production promotion,
or a general quality/cost/latency claim. It cannot establish semantic correctness
for open-ended tasks or any general benefit from cheap-model routing.

## Compatibility and documentation handoff

No supported signature/default/required storage or provider member changes.
Routing config/options and diagnostics are additive and absent by default; existing
return/event kinds, shared tools, strategy/plugin extensions and session versions
remain supported. Actual public package root/types consumers and ESM/CJS controls
verify the built exports. No break was proposed or approved.

Recipe, Version 2 availability/adoption/handoff, roadmap, approved design, README,
User Guide, generated API, AGENTS, affected context/native/helper/loop guides,
examples/index, AMOS docs/commands/tests, Changelog and package inventory are updated
in this stage. Release-wide publication remains pending. The next optional work is
independent API review of Stage 14B authority views and child-budget admission;
this delivery does not authorize it.

## Corrective validation

8,723 units / 383 files, 221 live cases / 13 suites, 38 offline modes and 194 public ESM/CJS controls pass. The [corrective completion](./STAGE_14A_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-22) records all R1–R3 changes, 35 additional unit regressions, five new real-provider cases, the new suspension example, AMOS coverage and unchanged public contracts.

## Second review checkpoint — 2026-10-23

S1–S3 are open. Fresh 830 tests / 19 files, consumer types and 194 public controls
pass but miss the eleven additional asserted observations. Source remains unchanged
against all 60 first-correction manifest files. No new full-unit/live gate or
runtime fixes were made by this review. Complete the
[second fix plan](./STAGE_14A_SECOND_REVIEW_AND_FIX_PLAN.md) before restoring completion.


## Second corrective delivery — 2026-10-23

All review findings are fixed. 8,775 units / 385 files, 224 live tests / 13 suites across OpenAI, Anthropic and Google with no required skips, 39 offline modes and 202 public ESM/CJS controls pass.
See the second corrective completion for admitted repair replay state, atomic
resume ownership, coherent suspension checkpoints and optional recovery metadata.
Existing provider/storage/default/session/JSON/streaming contracts remain; no new
AMOS command, release or later stage. Standard/generated docs and Version 2
availability/adoption/handoff are synchronized.
