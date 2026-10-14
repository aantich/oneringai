# Stage 03 — Durable evidence and projected tool outputs

Implemented on `version2`, based on committed Stage 06 revision `a98a498`.
Implementation remains in the working tree; no commit, push, publication or breaking
API approval is claimed. User authorization: “proceed” following the Stage 03
recommendation. Stage 07 remains separately authorized future work.

Current status: complete on branch, including all three corrective passes.
The [third corrective completion](STAGE_03_THIRD_REVIEW.md#corrective-completion--2026-10-14)
and [validation](../evaluations/STAGE_03_THIRD_CORRECTIONS_VALIDATION.json) record
7,473 units / 346 files, 66 live cases / 78 scenarios and 15 offline examples passed.
Earlier implementation, review and correction results remain historical evidence.
No release or breaking API change is claimed.

## Delivered scope

- `IEvidenceStorage`, scope/reference/record/chunk types, and optional
  `StorageRegistry.evidence` factory. Host-owned owner/tenant/namespace are not model
  arguments. Exact hashed scopes avoid filename-normalization collisions.
- Bounded `InMemoryEvidenceStorage` and atomic `FileEvidenceStorage`. The former
  promises process lifetime; the latter defaults to ordinary restart, with explicit
  optional fsync acknowledgement. Neither promises replicated durability.
- Immutable version-1 JSON observations with integrity hashes, bounded read/list,
  optional efficient scoped ID lookup, read backpressure, queued-mutation admission, explicit expiry pruning/deletion,
  bounded scope capacity, and conservative discovery acknowledgement.
- Opt-in post-settlement `ToolEvidenceMiddleware`, outside the existing tool
  execution/error/retry pipeline. Raw returns, semantic status, application events,
  accounting and existing execution plugins preserve their contracts.
- Output hints select a pure synchronous projection only after acknowledgement.
  Summary/envelope caps retain exact IDs rather than silently truncating them.
  Storage/serialization/projection failure retains raw results, independently of
  execution status. No model helper runs implicitly.
- `EvidencePluginNextGen`, enabled through `context.features.evidence`, adds a
  metadata-only recent index and bounded `evidence_read`/`evidence_list`. Model reads prefer a scoped ID; full-reference
  calls remain valid, and custom stores need no new mandatory method. Retrieval
  tools do not recursively record their reads. Existing external plugins already
  using feature key `evidence` and arbitrary plugin configuration retain precedence.
- Optional versioned tool-result/session metadata protects unacknowledged raw groups
  from compaction, scratch spill, emergency truncation and rollover. If retention
  cannot fit, dispatch stops explicitly. Async delivery with failed storage stops
  before converting results into unprotected text, including failed outcomes.
- Host-only `acknowledgeToolEvidence()` releases a matching raw group after the host
  stores its retained observation without executing the action again. It checks
  scope, original invocation/call, stored data and concurrent context/identity changes.
- Cancellation/timeout receipts can remain unknown; later settled observations are
  separate immutable records with original correlation, diagnostic-only delivery
  and no duplicate execution accounting.
- AMOS optional persisted evidence configuration, `/context evidence [id] [offset]`,
  metadata-only listing, explicit 1024-character previews, and separate persistence/
  projection/unknown-effect notices in run and streaming views.

## Design choices and limits

The existing history journal is append-oriented, permissive on corruption and
usually written without awaiting acknowledgement. It cannot supply the required
integrity/bounded-read/durability contract. This stage reuses StorageRegistry and
file conventions, without changing or overstating journal guarantees. No dependency,
action-intent layer, replay engine, distributed transaction, automatic semantic
compactor, model routing framework or binary artifact service was added.

Bundled stores accept strict JSON; non-JSON and lossy values fail evidence handling
without reclassifying the effect. Common credential keys are redacted and connector
capabilities/auth objects are excluded. Sensitive arbitrary source strings remain
subject to explicit host storage/redaction policy. File data is local JSON, not
an encrypted or replicated service. Custom backends must implement the documented
acknowledgement, ownership, integrity and capacity contract.

Limits/defaults, exact public setup, persistence, recovery, redaction and maintenance
are documented in [the adoption recipe](../DURABLE_EVIDENCE.md). File mutation
admission coordinates instances within one process; multiple writer processes need
host coordination or a transactional backend. Snapshot authority/configuration is
never restored from model-controlled data. Explicit host clearing/deletion/retention
is separate from automatic context reduction. No automatic action retry or completed
external workflow is inferred from a receipt.

## Compatibility evidence

- New configuration and metadata are optional; disabled evidence contributes no
  prompt/tools/writes/model calls, preserves old event/result keys, and avoids
  additional evidence callbacks/awaits in the standard disabled execution path.
- Existing `execute()` extension point, tool execution plugins, signals, circuit
  breaker policy and supported raw result contracts remain intact.
- Old saved contexts load without evidence fields. New plugin and content metadata
  are versioned optional additions to the existing persistence format.
- Existing external `evidence` feature registrations retain arbitrary configuration,
  factories, tools and prompt content. A new built-package fixture verifies both
  built-in use and the pre-existing open configuration contract.
- Strict public consumer fixtures for stages 00, 02, 06 and new 03 compile against
  the built ESM/CJS package declarations. No new mandatory fields or parameters.
- Local mocks cover both managed modes, raw application events, legacy-disabled
  packets, host hook changes, native async continuation/failure and no effect replay.

## Examples and AMOS

- [Durable search](../../examples/durable-tool-evidence.ts): synthetic large search,
  bounded projection preserving status/IDs, scratch eviction, history rollover,
  saved-context restore, and exact source recovery in a separate Node process.
- [Ambiguous action](../../examples/ambiguous-action-evidence.ts): one local simulated
  write, lost response, cancellation/unknown receipt, and no repeat action.
- [AMOS offline walkthrough](../../apps/amos/examples/evidence-offline.ts): real
  adapter/command, synthetic provider, metadata-only list and explicit bounded preview.
- Every new example is credential/network-free by default, uses public package
  exports, and cleans its temporary state. Live tests are separately opt-in.

## Validation and corrections

The final machine-readable [validation record](../evaluations/STAGE_03_VALIDATION.json)
contains counts, scoped coverage, commands, public compatibility, source fingerprints,
all provider probes and earlier failed attempts. The
[AMOS transcript](../evaluations/STAGE_03_AMOS_OFFLINE.txt) is generated by the
walkthrough, not a hand-written output example.

During implementation:

1. Initial focused failures came from a fixture default replacing `undefined`, a
   nonexistent inspection method, and a permission fixture retaining denial. The
   assertions were repaired without weakening storage/execution contracts.
2. Google rejected the new evidence reference's numeric enum with HTTP 400
   `INVALID_ARGUMENT` / `TYPE_STRING`. The new schema now describes numeric version
   1 without that enum; local reference validation still requires version 1. The
   initial six passing and three rejected probes remain in the validation history.
3. The first full unit run exposed a real legacy-string-message regression in the
   new protection guard (`content.some` assumed an array). Matching the existing
   protocol helpers' array guard fixes it; the original rolling-window test remains.
4. An existing Google Stage 06 helper returned a source marker plus the period
   immediately adjacent to it in the fixture prompt. Its source is now JSON-delimited;
   the exact-match assertion and purpose/accounting gate are unchanged. The original
   failed attempt remains recorded; this is no model reliability or quality claim.
5. Final compatibility auditing retained the existing open external-plugin config,
   prevented an extra undefined result key on disabled host-hook paths, and enforced
   the async storage-failure boundary for both success and failure outcomes.

6. Rejected async projectors/thenables are consumed as projection failures rather
   than leaving unhandled rejections after successful effects; two regressions cover
   this JavaScript-call boundary.
7. Live probes exposed fixture ambiguity after a controlled storage failure and
   a failed read after model-supplied full-reference arguments (the initial attempt did not retain the exact rejected fields). Terminal tool availability and
   raw-fallback instructions are explicit; exact source/call assertions remain.
   Model-facing reads now prefer scoped IDs, with host integrity resolution and
   backwards-compatible full-reference/custom-backend paths. Earlier attempts stay
   in the record; these functional probes do not promise infallible model behavior.

Final results are reconciled below. Stage completion is
separate from package release; the package version remains `1.2.0`.

## Documentation handoff

Recipe, README, User Guide, connector/tool catalog, context-preparation guide, agent
guide, examples index, AMOS guide and unreleased changelog are updated in this stage.
The API reference is regenerated. Version 2 availability/adoption/handoff and the
roadmap stage record are updated only after validation. Conditional Stage 11 action
replay and Stage 07 automatic compaction remain deferred, not completion prerequisites.

## Original completion evidence — 2026-10-13

All required gates pass: **7,337 units / 343 files**, including **109 new Stage 03
cases**; **57 live cases / 69 scenarios** across OpenAI/Anthropic/Google; **13 offline
examples**. Scoped new-component coverage is **99.81% lines / 91.48% branches**.
Build/24 exports, root/strict-test/example/AMOS types, lint, public consumer
compatibility, ESM/CJS runtime, AMOS build, generated API, package contents and
artifact checks pass. Snapshot scope/version rejection is preflighted before
conversation mutation. Invalid async storage policy/observer/projector results are
contained without unredacted writes, accessor execution or unhandled rejections.

The validated scope is strict JSON observations with process/restart/fsync boundaries
and explicit host retention/redaction. File writer admission is process-local for
the configured directory/scope. Model-facing reads prefer ID lookup; full-reference
and legacy custom-backend paths remain valid. No package release is claimed.
The next suggested core stage is 07, separately authorized.

## Corrective completion — 2026-10-14

All six review findings are fixed and validated. Corrections preserve queued and
settled observations, require result-bearing recovery, preflight full evidence
snapshots, bind projections to mutable source content and bound serialization
before quota admission. Optional source-budget configuration/backend hints preserve
legacy custom adapters; default raw returns, hooks and sessions remain compatible.
No action replay or breaking API change was introduced.

**7,397 units / 344 files**, including **60 new corrective regressions / 169 total
Stage 03 cases**; **60 live cases / 72 scenarios**; **14 offline examples** pass.
All 12 evidence live cases pass again after final local guards. Four evidence
components have **99.83% line / 92.36% branch coverage**. Build/types/lint,
public compatibility/ESM/CJS, AMOS, generated docs and package checks are recorded
in [corrective evidence](../evaluations/STAGE_03_CORRECTIONS_VALIDATION.json).
Original failures and successful gates remain historical evidence. See the
[review completion](STAGE_03_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-14)
for details, support limits and the bounded Google diagnostic. Stage 07 remains
separately authorized future work; this branch is not a published release.

## Second corrective completion — 2026-10-14

S1–S3 are fixed: complete protected pending groups survive input replacement;
authentic delivery-only results retain original recovery correlation; interrupted
observations survive detached session snapshots and same-instance restoration.
No public fields/methods became required and the session schema is unchanged.

Validation passes: 7,435 units / 345 files, 38 new regressions / 207 Stage 03 cases,
63 live cases / 75 scenarios across all three providers, 14 offline examples,
99.83% scoped evidence lines / 93.08% branches, and build/type/lint/public consumer/
AMOS/docs checks. The recovery example and real AMOS save/load regression cover
interrupted observations without replaying an action. Current evidence lives in
[second corrective validation](../evaluations/STAGE_03_SECOND_CORRECTIONS_VALIDATION.json);
prior review and validation remain immutable historical records.

## Third corrective completion — 2026-10-14

T1–T3 are fixed: partial completed batches survive stream closure and managed
failure exits; private delivery provenance distinguishes receipt-only storage from
an acknowledged result; restoration reconciles invocation identity across recovery
without duplicating final results or removing unrelated pending content. Raw
returns/events, defaults, optional outcomes, public signatures, backend requirements
and saved-session schema are preserved.

Validation passes: **7,473 units / 346 files**, **38 new regressions / 245 Stage 03
cases**, **66 live cases / 78 scenarios**, and **15 offline examples**, with zero
unit/live skips. Build, strict types, lint, public ESM/CJS and consumer compatibility,
examples, AMOS (including real stream closure/save/load), generated API and package
checks pass. The new public stream interruption demonstration needs no credentials.
Four evidence components have 99.83% line / 93.30% branch / 98.63% function coverage;
Agent/context integration is covered by regression/live tests, outside that scope.

[Third corrective evidence](../evaluations/STAGE_03_THIRD_CORRECTIONS_VALIDATION.json)
retains all initial failures, the stale-bundle AMOS check and successful rerun, and
the initial 65/66 live batch plus bounded Google diagnostics and final unchanged
66/66 rerun. The original failed Google answer was not retained; a fresh diagnostic
showed an exact-format violation. No provider reliability fix or weakened gate is
claimed. See the [full completion](STAGE_03_THIRD_REVIEW.md#corrective-completion--2026-10-14).
Stage 03 is complete on branch; Stage 07 remains separately authorized.
