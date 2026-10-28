# C3 — verified routines and same-process continuation

Status: complete on branch under the full sequential authorization. No package release or consumer upgrade is claimed.
The [approved API direction](CONSUMER_COMPATIBLE_APIS.md#3-explicit-execution-binding-and-verified-routines)
and [C2 foundation](CONSUMER_C2_DELIVERY.md) govern this delivery.

## Implementation design and review

Reuse the existing routine/task/control-flow engine. A private runtime binds task
submission, reflection, extraction, deterministic steps and recursive routines to
one selected composition. At task and final boundaries it waits for the required
host verifier. A waiting decision suspends that existing execution at its gate;
resume reconciles the observation before releasing the gate. It does not resubmit
the settled task prompt or repeat pre/post steps. No second workflow scheduler,
durable cursor, backend or automatic outer retry is introduced.

The public factory, result union, phase-aware callback, opaque continuation,
host-owned execution binding, inspect/progress and fresh-child tool adapter follow
the approved design. Observation snapshots are detached, bounded and operation-owned;
retain initial and latest verification rather than repeated full history copies.
The initial implementation exposes optional observation-byte and active-operation
limits with explicit defaults; admission fails rather than silently dropping data.

Review identified a necessary recovery seam: retaining an oversized unstored
source is insufficient if the host cannot retrieve it. The new facade therefore
adds host-only `readSource(operationId, sourceId, { maxBytes? })` and
`acknowledgeSource(operationId, sourceId, reference)` for retained observations.
These data-recovery methods remain available after close invalidates execution
continuations; they never start/resume work and are not registered model tools.
The runner instance is host-owned; applications authorize access before exposing
any host inspection/recovery method through their own transport. They are temporary source
ownership, not another durable journal/backend; the host archives through existing
evidence/storage facilities. Existing unacknowledged tool evidence still requires
its actual context acknowledgement and cannot be waived by a completion predicate.
No existing API is changed or requires migration.

Shared-manager tool scoping must both restrict visible definitions and reject
guessed out-of-scope invocation names through the existing permission/error path.
Preserve prior host permissions and enabled state, restore on terminal cleanup,
and retain ownership if restoration fails. Preflight the full nested definition,
unsupported scheduling/retry settings and dependencies before any pre-step.

Borrowed Agents/tasks remain host-owned. Owned tool children survive waiting and
are destroyed once only after safe terminal cleanup. Concurrent/foreign/stale
continuations, rejected authorization and invalid replacement bindings cannot
consume the only paused handle. Closing requests cancellation and invalidates
handles; actual late work and unacknowledged observations retain their recovery
ownership. Model-facing tool JSON contains no continuation, Agent or ModelTask.

Validation, examples, AMOS commands, review corrections and documentation handoff
are recorded below; implementation continues directly to C4.

## Delivered APIs and defaults

Root `createRoutineRunner` and the new execution/verification/observation/result/
inspection/tool types are available. The required verifier gates task readiness
and final post-step state. The existing routine engine/DAG/control-flow mechanics
remain in use; there is no second scheduler. Read [the complete public recipe](../VERIFIED_ROUTINES.md).
The prototype now imports actual C1–C3 exports and retains all 14 negative controls.

Observation views default to 1 MiB (8 KiB–64 MiB); active-operation admission defaults
to 32 (1–1,000). Host recovery is scoped to the live runner/operation and uses existing
backend references. Public source inspection has an explicit full-index seam and
bounded headers. Model-facing adapters return at most 32 distinct references with
an omission count, never live handles. Oversized usage metadata can be omitted
without losing the host's original ModelTask ledger. Repeated nested task IDs are
disambiguated with execution IDs. These are view/admission controls, not a heap bound.

## Review and corrections

- Enforced selected scopes both in model-visible definitions and dispatch, including
  guessed names/re-enabled tools, without replacing the shared manager or weakening permissions.
- Captured real raw tool arguments/results/effects privately before public observers;
  late updates cannot overwrite an earlier acknowledged receipt.
- Required strict reflection boolean plus finite sufficient score. Reconciliation
  rechecks the retained response, not the task action; warning quality stays separate.
- Added actual condition gates, explicit scheduler skip metadata, nested preflight,
  false/zero result preservation and distinct leaf/group execution correlation.
- Bound verification to its exact nested absolute deadline. Rejected/throwing/aborted
  authorization and invalid tasks do not consume the paused capability.
- Added final verification for early pre-step failure, restored colliding parent
  memory/hook state, and retried failed cleanup bookkeeping without repeating actions.
- Retained ownership through raw/late persistence settlement. Closing protects
  undelivered/late observations, revokes handles and cancels queued async delivery
  without starting another model call. Authentic async continuation uses the original task.
- Rejected pre-existing unstored context evidence before another routine pre-step.
  Source archival does not waive the separate context evidence acknowledgement.
- Fixed AMOS command registration and tested real wait/inspect/confirm/cancel behavior.

## Validation and adoption

All **8,885 unit tests / 390 files**, **239 cumulative live tests / 16 files** across
OpenAI, Anthropic and Google, **594 runtime/package assertions**, and **43 offline
example modes** pass. The final source also passes its three-provider C3 smoke.
The focused ownership/routine regression group has 68 cases; this slice adds 38
unit cases including AMOS. Build/24 exports, types, lint, example/AMOS types,
built public consumer, design prototype and generated API all pass.
The package inventory contains **277 files**, including the recipe, example,
delivery and machine validation record, with no .env file. Current evidence and
source hashes are in [C3 validation](../evaluations/CONSUMER_C3_VALIDATION_2026_10_23.json).

Two existing Google synthetic assertions failed in the initial cumulative run.
Safe assertion diagnostics and tighter marker-only instructions were added without
raising caps or weakening usage/call-count/marker checks. Targeted checks and the
complete 239-case rerun pass; no provider failure is waived. Later C3-only lifecycle,
correlation and preflight refinements passed the final full unit/public/compatibility/
offline gates and final three-provider C3 smoke; the record distinguishes these runs.

The offline example submits once, waits for host confirmation, resumes its cursor
and verifies a post-step artifact with one model call. AMOS `/routine demo` uses
synthetic local actions and one billable selected-model call, then exposes inspect,
confirm and cancel. README, User Guide, generated API, examples, AMOS docs,
changelog, agent guide, Version 2 and roadmap/ledger are updated. Legacy routine
signatures/defaults, task/session DTOs and literal remote protocol 2 remain intact.
C3-R durable workflow restoration, a new backend, production host predicates,
consumer dependency adoption and release remain outside this delivery. Next: C4.
