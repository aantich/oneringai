# Stage 03 review and fix plan

Reviewed 2026-10-13 on `version2`, against the uncommitted Stage 03 implementation
based on Stage 06 commit `a98a498`.

**Current status: all six findings are fixed and validated on 2026-10-14.** See
the corrective completion record below and
[validation](../evaluations/STAGE_03_CORRECTIONS_VALIDATION.json). The findings
and reproductions describe the original review snapshot, when three P1 and three
P2 issues were open. No runtime code or permanent tests were changed during that
review. The original successful
[implementation validation](../evaluations/STAGE_03_VALIDATION.json) remains
historical evidence; it does not cover the failures reproduced here.

A subsequent [second review](STAGE_03_SECOND_REVIEW.md) found three additional P1
retention defects. The six corrections recorded here remain valid; overall Stage
03 completion was restored by that corrective pass. A subsequent [third review](STAGE_03_THIRD_REVIEW.md)
found two P1 findings and one P2 finding, now resolved by the
[third corrective completion](STAGE_03_THIRD_REVIEW.md#corrective-completion--2026-10-14).

The review covers storage and serialization, middleware and tool settlement,
managed/async context delivery, recovery, persistence, public compatibility,
examples, documentation and AMOS. At review time, all 109 existing Stage 03 unit
tests passed in a fresh run, as did the built public-package compatibility consumer. The
[review evidence](../evaluations/STAGE_03_REVIEW.json) contains the observations,
source fingerprints and executable synthetic reproductions. No credentials or
real external writes were used. The previously recorded provider tests were not
rerun during this review: these defects occur in deterministic local boundaries.

## R1 — P1: Failed async delivery consumes the undelivered queue

Location: [continuation cleanup](../../src/core/Agent.ts#L3823), following the
[failed-evidence guard](../../src/core/Agent.ts#L3765).

`continueWithAsyncResults()` selects queued native async results and rejects a
`storage_failed` receipt before injecting anything. Its unconditional `finally`
still consumes those entries. Cleanup clears execution tracking as well. A host
that repairs storage cannot resume the ordinary queued continuation: it now
receives `No async results to deliver`. A separately retained completion-event
object can be supplied explicitly, but the framework's queue has discarded the
completion it was supposed to preserve.

**Reproduction:** A real local async tool completes once while the evidence store
rejects writes. With `autoContinue: false`, there is one queued result. The first
public continuation rejects with the unacknowledged-evidence error and leaves zero
queued results. A second continuation reports no results. The controlled provider
was called only twice for the original run; neither continuation dispatched a
model request.

**Fix:** Consume current entries only after their delivery is committed, or when
scope cancellation explicitly invalidates them. Retain blocked completions for
host recovery. Prevent automatic flush scheduling from repeatedly retrying a
retained storage failure; resumption should follow a host recovery/update. Reuse
the existing queue, completion event and receipt mechanism.

**Regressions:** Queued native results with automatic and manual continuation;
storage failure followed by repair/resumption; no extra tool execution; no model
dispatch before repair; no automatic busy loop; mixed batches; listener/injection
errors; cancellation, identity changes and destruction. Exercise the mid-loop
injection path and explicitly supplied results separately.

## R2 — P1: A receipt without a result releases raw-data protection

Location: [recovery acknowledgement checks](../../src/core/context-nextgen/AgentContextNextGen.ts#L1249).

`acknowledgeToolEvidence()` checks the record's principal, call and execution ID,
but does not require the stored observation to contain a result. The public
middleware legitimately supports receipt-only records. Passing such a receipt
for the original invocation marks its retained result as stored and permits
compaction/rollover, even though that record cannot recover the observation.

**Reproduction:** Execute a synthetic write successfully with storage unavailable,
retain its raw tool result in context, then repair the store and call
`ToolEvidenceMiddleware.record()` with the same outcome and no result argument.
Acknowledgement returns `1`. Rollover succeeds and removes the raw result. The
only evidence record has no `result` property.

**Fix:** Distinguish receipt acknowledgement from result recovery. Releasing a
retained result requires a result-bearing recovery observation for its invocation;
a cancellation/error/status-only receipt must not qualify. Preserve original
scope/call/execution checks and intentional host redaction. Do not require equality
with unredacted application data when policy deliberately transforms the stored
payload. Keep this within the existing host-only recovery API.

**Regressions:** Reject matching receipt-only observations without changing
protection; reject mismatched call/execution/tool metadata where available; accept
valid redacted result recovery, including explicit `null` if policy permits it;
retain all raw groups when acknowledgement fails; preserve concurrency guards and
successful later rollover. Cover read and write tools and restored contexts.

## R3 — P1: Cancellation can discard a result that already settled

Locations: [settlement observer](../../src/core/ToolManager.ts#L1140),
[abort check](../../src/core/ToolManager.ts#L1153), and
[catch persistence](../../src/core/ToolManager.ts#L1165).

The settlement observer sets `settled = true`, but records the value only if
`abandoned` is already true. An abort can win while the pipeline's fulfillment and
the abort-aware await are being processed. The catch branch then sets
`abandoned = false` because settlement was observed, and persists a receipt without
the result. Neither branch records the returned value. The caller receives an
exception rather than a raw return, and storage contains no result to recover.

**Reproduction:** A synthetic write returns its source object once and schedules
cancellation through a controlled microtask chain. Five neighboring interleavings
produce `status: cancelled`, `completion: settled`, one evidence record, and zero
result-bearing records. This reproduces with both current source and built exports.

**Fix:** Retain the settled pipeline value independently of cancellation delivery
and make persistence ownership explicit. A returned observation must be recorded
once even if the caller's await aborts. Keep cancellation status truthful, preserve
original correlation and keep any later observation diagnostic-only. Avoid
duplicate accounting, projection delivery and external retries.

**Regressions:** Controlled cancellation immediately before, during and after
fulfillment/rejection; settled values including `null`; normalized error results;
deadline races; manager destruction; slow/failed storage; original IDs; exactly-once
accounting and no late result injection into a later run.

## R4 — P2: Rejected same-scope snapshots partially replace context

Locations: [scope-only preflight](../../src/core/context-nextgen/AgentContextNextGen.ts#L2651),
[restore assignment](../../src/core/context-nextgen/AgentContextNextGen.ts#L2665),
[load assignment](../../src/core/context-nextgen/AgentContextNextGen.ts#L2536), and
[remaining receipt validation](../../src/core/context-nextgen/plugins/EvidencePluginNextGen.ts#L118).

Preflight checks evidence version and scope only. The context installs conversation
and system prompt before the plugin checks the recent-receipt structure. A
same-scope snapshot with an invalid receipt therefore throws after replacing those
fields, potentially after restoring earlier plugins as well. The caller observes
failure while subsequent work uses rejected state.

**Reproduction:** Supply a same-scope version-1 snapshot whose `stored` receipt
omits its reference. Both `restoreState()` and `load()` throw `Evidence invalid`
but leave the snapshot's replacement conversation and system prompt installed.
The existing foreign-scope rejection regression passes and misses this case.

**Fix:** Validate the complete evidence snapshot before any context/plugin state
mutation, using a shared pure validator and a separate commit step. Preserve old
sessions without evidence state, host-owned configuration and existing extension
contracts. This does not require a general persistence transaction framework.

**Regressions:** Both entry points; invalid receipt arrays, enums, references and
bounds; matching/foreign scopes and versions; original conversation, system prompt,
pending input and existing plugin contents unchanged on failure; successful old
and new session loading.

## R5 — P2: In-place host hook changes keep a stale projection

Location: [after-tool modification handling](../../src/core/Agent.ts#L3368).

The projection is created before `after:tool`. Invalidation compares object identity
after the hook has already executed. Mutating an existing result object and
returning it as `modified.content` preserves that identity, so the old projection
still reaches the model while application listeners receive the host's changed
status and identifiers. This contradicts the documented rule that host content
changes supersede the projection and the existing mutable hook contract.

**Reproduction:** A hook changes `ORIGINAL`/`OLD_ID` to `HOST_CHANGED`/`NEW_ID`
on the result object and returns that same object in `modified.content`. The raw
completion event contains the new values, while the next model packet contains
the old values and omits `NEW_ID`.

**Fix:** Detect supported hook mutations against the pre-hook view, or
conservatively discard the projection at that extension boundary when its
consistency cannot be established. Preserve raw object identity and existing
mutable hooks; do not fix this by freezing caller objects or requiring immutable
hook returns. Keep the stored pre-hook observation's provenance clear.

**Regressions:** Replacement, nested in-place mutation, direct context-result
mutation, unchanged and metadata-only hooks, multiple hooks, thrown hooks and
non-JSON replacements; run and stream; model packet/application return agreement;
disabled evidence compatibility.

## R6 — P2: Byte limits apply after unbounded serialization work

Locations: [store serialization before admission](../../src/infrastructure/storage/EvidenceStorage.ts#L96),
[recursive encoder](../../src/core/evidence/validation.ts#L23), and
[middleware cloning before storage](../../src/core/evidence/ToolEvidenceMiddleware.ts#L77).

The encoder builds complete strings before the store checks its byte cap. The store
encodes the payload twice, parses it and allocates a Buffer first; middleware also
clones inputs before that limit is consulted. The depth limit rejects deep trees
but does not bound breadth or repeated expansion of a small acyclic shared graph.
Queue admission happens after this work. A small configured storage quota therefore
does not bound transient allocation or synchronous event-loop work, and the
acknowledgement timer cannot interrupt synchronous serialization.

**Reproduction:** An acyclic source graph containing 18 distinct result objects expands
to 6,291,438 JSON characters. A public in-memory store configured for 512-byte
records eventually rejects it with `capacity`, but the source reproduction takes
571 ms and observes roughly 45.8 MB additional used heap at rejection. The built
reproduction takes 509 ms with roughly 62.2 MB additional used heap. These are
single-run observations, not stable timing or peak-memory benchmarks. Larger
graphs can expand further; an out-of-memory crash was not induced.

**Fix:** Add an incremental encoded-byte/work budget before concatenation and
cloning, including arguments, redaction output and the stored envelope. Check
mutation admission before expensive queued work where possible. Reuse the strict
encoder and existing limits; do not add a serialization framework. Preserve
no-getter/no-`toJSON` behavior, exact accepted JSON and raw fallback on failure.

**Regressions:** Oversized strings, wide structures and repeated shared subtrees;
Unicode/escaping byte accounting and wrapper overhead; configured/default limits;
busy admission; strict serialization and redaction; no persistence/projection or
effect-status change on failure. Assert bounded work/allocation structurally rather
than using flaky wall-clock thresholds.

## Corrective delivery order and acceptance

1. Preserve cancellation settlement values and queued async completions, R3/R1.
   Add permanent failure/recovery regressions before relying on the existing suite.
2. Tighten host recovery admission, R2, while preserving intentional redaction.
3. Preflight full evidence snapshots and invalidate stale hook projections, R4/R5.
4. Bound serialization/admission work, R6, across both stores and middleware.
5. Update the evidence recipe, examples and AMOS support notes where behavior
   changes, plus Version 2 adoption/handoff and this review's resolution record.
   Regenerate API documentation if public signatures or comments change.
6. Build, run full unit/type/lint checks, public compatibility consumers, examples
   and relevant AMOS checks. Run the full opt-in agentic provider suites after the
   shared execution changes, retaining failures and provider unavailability
   explicitly. Verify recovery never repeats the external action.

No breaking API change is proposed. Preserve optional configuration, disabled
defaults, legacy raw returns/events, mutable hooks, custom storage adapters and old
sessions. If a corrective implementation requires a concrete break, stop that
affected work and obtain the user's explicit approval first.

The current storage interface, registry integration and opt-in plugin structure
are sufficient. A router, new queue service, automatic action replay, distributed
locking or broader snapshot framework would expand this fix unnecessarily.
Documented process-local quotas, path-alias coordination, filesystem durability
and host redaction limits are support boundaries, not additional findings.
Stage 07 remains future, separately authorized work; correcting Stage 03 comes first.

## Corrective completion — 2026-10-14

All six findings are fixed on the existing `version2` branch. User authorization:
“fix all.” No breaking API change, commit, push or package release was made.
The [corrective record](../evaluations/STAGE_03_CORRECTIONS_VALIDATION.json)
retains the original review, red regressions, intermediate failures, final checks
and source fingerprints.

| Finding | Delivered correction |
| --- | --- |
| R1 | Undelivered native async completions remain queued. Failed evidence and pre-injection host errors block automatic retry loops; explicit host continuation resumes after repair. Already inserted results are consumed once, including observer failures. Scope invalidation still removes delivery eligibility. |
| R2 | Host acknowledgement requires a result-bearing record, matching invocation and known tool name. Function/custom call-ID namespaces remain independent. Intentional host redaction and explicit null remain valid. |
| R3 | Settlement retains the returned value independently of abort-aware delivery. Cancellation races persist that observation once; late outcomes keep original IDs, diagnostic-only delivery and single accounting. Cancelled observations do not produce projections. |
| R4 | One pure complete evidence-snapshot validator runs before any context/plugin mutation in both restore/load paths, and is reused by plugin restoration. Old sessions and host-owned configuration remain supported. |
| R5 | Authenticated projections are bound to their captured source digest. Mutable hooks, direct replacements and retained-result changes invalidate stale projections before managed/async admission, preserving raw identity and existing hooks. |
| R6 | Strict incremental UTF-8 encoding bounds bytes/work before full expansion. Stores admit mutation capacity before synchronous source capture and reuse encoded JSON for integrity wrapping. Optional backend hints/configuration bound middleware arguments, source, redaction output and combined observations; existing custom adapters remain valid. |

Validation passes:

- **7,397 unit tests / 344 files**, zero failures/skips. **60 corrective regressions**
  bring total Stage 03 coverage to **169 cases**. New tests cover repair without
  replay, wrong/receipt-only acknowledgement, cancellation interleavings, null under
  a documented host normalizer extension, destruction, complete snapshot rejection,
  mutable hooks, Unicode/escaping, shared graphs, quotas and reentrant admission.
- Four evidence components: **99.83% lines / 92.36% branches**. These are scoped
  metrics, not a repository-wide coverage claim.
- **60 live cases / 72 functional scenarios** across OpenAI, Anthropic and Google
  pass with unchanged completion checks. Three new live cases verify in-place hook
  mutation. After final local namespace/admission guards, all **12 evidence cases**
  pass again on final source. Those guards do not change provider conversion, valid
  live writes or evidence-disabled foundation behavior.
- **14 offline examples** pass, including the new
  [failed-write recovery example](../../examples/evidence-recovery.ts): the action
  executes once, receipt-only recovery is rejected, exact result recovery permits
  rollover, and the process-local support boundary is explicit.
- Build/24 exports, root/strict-unit/live/example/AMOS types, lint, built public
  compatibility, ESM/CJS runtime, AMOS build and generated API all pass.
  The [AMOS transcript](../evaluations/STAGE_03_CORRECTIONS_AMOS_OFFLINE.txt) exercises
  the actual runner/inspection commands against the final public package.

The first expanded suite had one regression-fixture mistake: the existing
ResultNormalizer intentionally converts null to an error result. The null test
now uses the documented host normalizer extension; production normalization was
not changed. The first 60-case live batch passed 59 cases and failed Google's
chat exact-answer check after using 512 output tokens. Its original answer was
not retained, so the exact text is unknown. Three bounded same-prompt/model/cap
calls and the subsequent complete live gate passed; the failing record is retained
without asserting an unsupported root cause or weakening the answer check.

Optional `serializationLimitBytes` and `maxSerializationBytes` are additive. A
host may explicitly allow a larger source that its redaction policy reduces to a
smaller record; final backend quotas still apply. Custom stores without either
setting retain their previous capacity policy. No new mandatory adapter methods,
default context tools or implicit model calls were introduced. Existing raw returns,
mutable hooks, session loading and external feature factories remain compatible.

AMOS needs no new command for these corrections: its adapter inherits bundled
storage limits, and the five existing adapter/command tests plus the final offline
walkthrough verify inspection and diagnostics. Its support notes explain recovery
and source limits. Standard docs, Version 2 availability/adoption/handoff, examples,
release notes and package evidence are synchronized. Stage **07** is next and
requires separate authorization.
