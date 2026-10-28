# C6 — complete trusted construction and child operation ownership

Status: complete on branch under full sequential authorization; no package release.

## API and compatibility review

Add `createOrchestratorWithFactory(config, options): Promise<Agent>` and root types
`OrchestratedAgentConfig`, `AgentConstructionRequest`, `ChildObservation`,
`OrchestratorFactoryOptions`. The signatures match the approved C6 prototype;
`configureAgent` is required and may return a complete config asynchronously.
`descriptionExecution` applies only to creation-time descriptions, while
`onChildOutcome` observes separate child diagnostics. A settled child response or
submission receipt does not prove business completion. Existing createOrchestrator,
OrchestrationToolsContext's synchronous worker callback, default async behavior,
tool result DTOs and Agent construction remain unchanged.

The callback receives detached baseline containers with role/name/type, not a live
workspace/Agent. A parent has no type; a worker always has an authorized type.
The returned config is complete, not a patch or a hidden deep merge. Preserve
ordinary inference/options/hooks/limits/errors/async/history/model execution and
complete context/storage settings, including zero/false/absence. Worker defaults
use original role/type connector/model fallbacks, never a root callback's provider,
account, native tools, permissions, conversation or inference overrides.

Reject live Agent/context/manager and forbidden own hierarchy/manager keys at
runtime as well as in TypeScript. Preflight host/context/reserved tool conflicts
and duplicate live conversation/session identities before construction. Dynamic
plugin/identity collisions are checked on the actual single construction, with
owned-resource rollback. Preserve executable/backend/callback handles; do not
JSON-clone configuration or trial-construct an Agent to discover its tools.

## Implementation boundaries

Reuse the existing orchestrator tool/delegation/monitor engine behind a private
selected factory policy. A small private context-construction marker installs the
one owned workspace and collision checks before initial plugin/lifecycle work.
Workers borrow that board with skip-destroy ownership; the parent owns it. Host
features/timezone/reserve/strategy/storage remain intact. A competing workspace
is a new-path configuration error. Host approval of a worker grants membership
in this shared board; it does not establish private memory or tenant isolation.

Reserve worker names/capacity before awaiting the callback. A failed/cancelled
lookup releases its reservation once; late resolution cannot construct an orphan.
Do not claim an arbitrary host lookup was stopped. Borrowed connectors/backends/
tasks remain host-owned through failure and shutdown.

Capture explicit binding at each actual parent operation/child admission, including
automatic continuation and monitor calls. Do not hold a constructor-lifetime task.
Use the C2 child lease for cooperative signals, raw-work settlement and occupancy;
timeouts/cancellation request stop and quarantine a still-settling worker. New
turns cannot reuse that instance before actual settlement. Preserve original
operation/call correlation for late diagnostics; never cancel shared-task siblings
as a side effect of cancelling one child. Child model/helper calls use the original
explicit local task when supplied. Missing explicit task means independent accounting.

Use existing model-ledger parent-invocation correlation rather than another usage
ledger. Observations include original IDs, response/loop/evidence and invocation
references; observer failures are isolated. No new workflow/delegation policy,
distributed budget, global inspector, permission cache or backend is introduced.

Detailed field precedence and ownership remain in the [approved API table](CONSUMER_COMPATIBLE_APIS.md#configuration-ownership).
Acceptance covers every forwarded field with actual provider requests, creation-
time plugin/hooks/storage behavior, provider/account isolation, no-memory budgets,
collisions/rollback, concurrent admissions, timeout/late work, original async and
monitor accounting, false/waiting verification, legacy controls, runnable examples,
relevant AMOS disposition and full public/Version 2 validation. Results follow here.

## Review and corrections

The selected factory composes complete returned configuration once and reuses the
existing five-tool/delegation/monitor implementation. Construction installs the
mandatory board before plugin initialization, checks collisions on the actual
manager, and rolls back only owned resources. Explicit flags remain intact;
matching principals are checked before ordinary context spread precedence applies.
Detached containers retain executable/backend/callback and permission-policy handles.

Review fixed per-operation admission capture before async hooks, unique pending
worker reservations, pre-expired zero deadlines, original async/task delivery,
authenticated result-bearing receipt repair, actual raw-work occupancy, deferred
worker/board cleanup, and late unstored JSON source retention in the existing
context/evidence path. Existing workspace-delta construction is reused. Shared
child cancellation never cancels a borrowed task or siblings. A routed internal
root ledger cannot promote an originally unbound operation into shared authority;
an unrelated custom strategy config cannot implicitly enable a model ledger.

Selected monitors explicitly receive root inference/cache/data controls and the
current task/signal; public runDirect and legacy monitoring keep their defaults.
Child observations add optional actual `toolOutcomes` without changing any old
DTO/event shape. Exact public types and all prior negative compile controls are
checked against the built package, replacing ambient C6 prototype declarations.

The first cumulative live run exposed four C6 fixture failures: a vague task with
workspace tools exceeded its two-call connectivity budget or produced a refusal.
The bounded connectivity fixture now explicitly asks for a literal echo and uses
the returned host before-LLM hook to exclude tools. It asserts real cross-vendor
child/monitor requests and every invocation's successful status; it does not
claim to measure autonomous task quality. A Google routing repair fixture's
answer-like corruption label competed with the actual answer. Corruption now
changes syntax while retaining the provider's actual value. All 29 selected
C6/routing live cases pass after these corrections; final cumulative results
are recorded below. No failed required provider/suite is waived.

The offline example initially expected ordinary runDirect to inherit Agent
temperature. It now separately proves a normal root request and the selected
configured monitor request, with two shared-operation calls plus one independent
root probe. Declaration generation exposed two private inferred-type names;
explicit queue/signal types fix the package build. These were validation defects
that were corrected, not limitations deferred to consumers.

## Support and adoption boundaries

Read [the public recipe](../ORCHESTRATOR_FACTORY.md) and run
[the offline example](../../examples/orchestrator-factory.ts). New configuration
returns a complete plain object, never a prebuilt Agent/context/manager. Host
authorization resolves each worker independently and approves access to one
shared board. Distinct conversation/session identity does not prohibit explicitly
shared evidence/backend/task scopes. Existing Agent configuration precedence,
callback invocation semantics and per-call provider validation still apply.

The child observer separates settled runtime work from business verification.
Pending work or unacknowledged source blocks reuse/destruction; retained workers
remain inspectable through AgentRegistry after root destruction until existing
host archive/acknowledgement/cleanup procedures complete. No durable workflow,
new backend, permission cache, universal inspector, automatic extraction,
distributed budget or changed saved DTO is introduced. Actual effect completion
still needs host confirmation.

AMOS has no orchestrator construction/settings surface: it builds a single Agent.
Its documentation points to the library example; no command or saved config is
invented. README, User Guide, agent guide, examples/index, unreleased notes and
generated API are updated with this slice. Version 2 availability/adoption and
release-wide handoff follow the completed gates below. ICOS adoption and package
publication remain separate work.

## Completion — 2026-10-23

All 9,044 unit tests pass (42 C6 cases: 22 factory, five construction, five
operation binding and ten configuration cases). All 257 cumulative live cases
in 19 files pass across OpenAI, Anthropic and Google; all six C6 cross-vendor
run/stream cases also pass on the final built source after the last worker
recovery/scope fixes. This distinction is explicit in the
[machine evidence](../evaluations/CONSUMER_C6_VALIDATION_2026_10_23.json).
The 29 selected routing/C6 correction cases pass without a skipped provider.

All eleven build/unit/type/lint/example/AMOS/public-consumer/design/API/runtime/
offline gates pass. Public fixtures include 1,270 assertions, with 208 new
checks across 16 mixed ESM/CJS/cache-copy combinations; all 46 offline modes pass.
Package contents, local documentation links and final changed-source hashes are
audited in the evidence record. Existing constructors, synchronous callbacks,
raw results, old async defaults, context/session DTOs, and literal remote
protocol v2 remain supported. Publication and ICOS adoption are not claimed.

The final review additionally made worker continuations use the same authentic
original-source/receipt proof as the parent and kept an absent identity policy
distinct from an explicit empty policy. These are new-path guards, with no
behavior change to ordinary Agents or old orchestrators. Continue C7 under the
existing all-slices authorization; no routine approval stop is needed.
