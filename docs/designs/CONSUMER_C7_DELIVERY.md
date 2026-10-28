# C7 — negotiated remote observations

Status: stage-entry design and implementation in progress under the user's
all-slices authorization. C6 is complete. No v2 API or wire change is proposed.

## Stage-entry API and wire review

Use a separate literal `AGENT_PACKAGE_OUTCOME_PROTOCOL` with value
`oneringai.tool-outcomes/1`. `AGENT_PACKAGE_PROTOCOL_VERSION` remains literal 2;
its types, old DTOs, loader, server, classifier and transport remain unchanged.
The new `OutcomeAgentPackage` wraps a normal `SerializedAgentPackage` and optional
remote observation checkpoint. Old loaders reject the new outer envelope before
dispatch; new loaders require explicit negotiated support and never downgrade.
The inner package describes tools/history; it grants no authority.

The additive entry points are:

```typescript
const server = new AgentPackageOutcomeServer(sourceAgent, legacyPackage, {
  storage: scopedEvidenceStorage,
  authorize: async (access, trustedHostContext) => hostAuthorize(access, trustedHostContext),
});
const envelope = server.package();
const { agent, session } = await hydrateAgentPackageWithOutcomes(envelope, {
  // Existing trusted hydration connector/model/context/permissions options.
  ...trustedHydration,
  transport: authenticatedOutcomeTransport,
});
```

`createAgentPackageOutcomeTools(envelope, { transport, storage, ... })` also returns
`{ tools, session }` for complete pre-construction configuration. Pass those tools
and the same storage handle in the host's C6 `configureAgent` result, with the
ordinary evidence plugin enabled. One session owns one manager; create a fresh
toolset/session for a fresh Agent or `scopedTo` child instead of copying a live
session's tools across conversations. This restriction belongs to the new owned
session API; ordinary tools/old remote helpers retain their contracts. The
hydration convenience and tools-first path share the same client implementation.
Tools-first checkpoints use `session.checkpoint(agent, options?)`; the hydrated
pair can use `session.checkpoint(options?)`. No second tool pipeline is constructed.

`RemoteOutcomeTransport` defines exactly five wire responsibilities: `negotiate`,
`execute`, `getReceipt`, `cancel`, and `readEvidence`. The host adapts its existing
authenticated transport; the library adds no HTTP client or RPC framework.
Each message uses the separate protocol discriminator, package/session/request
identity where relevant, and bounded strict fields. Negotiation returns current
trusted tool definition fingerprints/effects and capacity/read limits. Executable
definitions, effects and permissions come from actual server registrations, never
mutable package hints. Execution admission must detect registration changes across
async authorization/hooks before invoking a different implementation.
Execution carries an expected `toolFingerprint` over the negotiated callable
schema/effect; the server compares it with current trusted metadata and pins the
actual executable at admission. That request hint cannot grant authority.
Authorization receives the actual selected effect, never the caller's hint.

Every operation rechecks current host authorization, including cached receipts,
cancellation and every evidence chunk. Trusted host context is a server method
argument closed over by the transport adapter; it is absent from model-controlled
wire arguments. Evidence references resolve only through the selected scoped
backend. No URL or model-selected tenant/store authority is accepted.

Receipts have `pending`, `settled` or `unknown` state, stable request ID and
canonical argument fingerprint, actual admitted effect, optional actual server
ToolExecutionOutcome, bounded error and scoped full-source reference. A settled
pre-admission rejection has no fabricated server invocation. Source result payload
is separate from receipt metadata, avoiding duplicate bodies. Process-local
deduplication retains admitted identity through settlement; capacity rejects new
admissions instead of evicting in-flight or receipt authority. Restart lookup can
be unknown and never authorizes re-execution.

`hydrateAgentPackageWithOutcomes` returns a normal Agent and its owned
`RemoteOutcomeSession`. This explicit companion exposes pure bounded per-operation
`inspect`, receipt lookup, cancellation, bounded evidence reads and a new outer
checkpoint. It does not extend old Agent/event/session DTOs or introduce a global
inspector. Observer rejection cannot repeat work. Close retains unsettled source
correlation and does not claim server cancellation or rollback.

## Managed bridge, evidence and recovery

Keep actual proxy and actual server outcomes separate: never overwrite local
IDs, timestamps or completion with remote facts. Business `{ success: false }`
remains successful data when the owning server tool reports success. Owning
operational failure uses C1 provenance. Missing/uncertain remote observations
remain unknown; an interrupted write cannot acquire a new request ID and submit
again merely because the proxy settled or the transport disconnected.

The new bridge must affect managed run/stream and async recovery decisions even
without an opt-in loop policy. Unknown write/unknown effects stop before another
model/action dispatch. The selected session preserves the admission barrier until
explicit receipt/source reconciliation. Raw results and old event shapes remain
unchanged; sidecar diagnostics are available through the new companion.

Persist full allowed source plus both observations atomically in an explicitly
documented new observation envelope inside existing `EvidenceRecord.result`.
Existing evidence/storage schemas do not gain fields. A missing/unacknowledged
sidecar cannot become a full result-bearing proof merely through proxy success.
Receipt-only records have no result and retain existing compaction protection.
Known full results whose storage fails remain retained for host repair; storage
failure never triggers another external action. New-path acknowledgement and
checkpoint recovery verify envelope/correlation in the owning backend. Mutable
checkpoint data alone is not observed authority. Missing proof remains unknown.

Before sending an action, the client stores an immutable scoped admission record
binding the actual proxy invocation/call IDs, remote request/session, tool and
argument fingerprint. This is a host observation record with its own identity,
not a fabricated successful proxy/server outcome. A failed admission write sends
no action. Checkpoints carry that reference; recovery verifies it against the
owning backend before binding a receipt or full source to an old proxy invocation.
This avoids trusting mutable checkpoint IDs or making a receipt-only record look
like result-bearing proof. It uses the existing storage interface, not a journal
backend, distributed transaction or exactly-once execution promise.

Server and client retain exact sources when inline/serialization/storage capacity
is exceeded. Use bounded chunked evidence retrieval or explicit retained-source
repair, never prefix slices. Host-only recovery may expose a bounded retained
source and accept a matching acknowledged record, as the existing routine facade
does; it does not add wire actions, a backend or a durable workflow cursor.

Cancellation derives a per-request controller. HTTP/client abort establishes only
proxy observation; explicit authenticated cancellation requests server stop.
Late server outcomes retain original IDs and update receipt/source without action
replay. Neither cancelling one invocation nor closing a proxy cancels siblings or
a borrowed ModelTask. No live ModelTask crosses the wire; host aggregation uses
stable observation IDs and explicit unknown external costs, with no double charge
or distributed hard-budget claim.

## Required completion evidence

Review/fix strict schemas before dispatch, actual admission/effect provenance,
authorization on all five operations, stable deduplication, pending/late/oversized
source retention, cancellation and pure bounded inspection. Cover v2↔v2 and new
peers, mixed-version rejection, forged/reordered/duplicate observations and
references, tenant isolation, interruption after submission, current authorization
changes, backend failure and real restart recovery. Compare authoritative local
and server semantics while keeping proxy settlement separate. Acknowledged source
must survive prompt compaction/restart without fake workflow resume.

Ship an authenticated in-memory transport example with a read, valid declined
business data, one uncertain synthetic write, exact evidence recovery and no
resubmission. Exercise real LLM managed run/stream through the new bridge where
relevant. Update AMOS only at its actual library transport/diagnostic surface;
ICOS desktop/SSE wiring, dependency upgrades, production backends and releases
remain excluded. Update standard guides, generated API, Version 2 availability,
adoption/handoff, package inventory and machine evidence before completion.

## Implementation and review record (2026-10-28)

The separate server/client facade, strict five-message protocol, tools-first C6
construction and shared hydration engine are implemented. Source execution reuses
C2 ownership plus ordinary Agent external hooks/permissions; actual selected
registrations are pinned across asynchronous authorization and before-tool hooks.
Client execution reuses C1 and the single ToolManager. Admission, full source and
local observation records use the existing scoped evidence backend.

Review corrections include optional-field serialization before admission, a
separate content digest for chunked records (backend references hash scoped storage
blobs), backend proof after host redaction, independent proxy/source identity,
explicit admission failure without submission, bounded requests without eviction,
post-submission disconnect barriers and safe source repair. Cancellation retains
raw source work and late correlation. Evidence acknowledgement timeouts now track
the underlying storage promise until actual settlement, rather than releasing C2
ownership at the earlier acknowledgement deadline. A C6 async-repair regression
also removed an overstrict argument-equality check that rejected legitimate host
redaction; immutable invocation/scope/tool/status/completion checks remain required.

The first broad unit/example run overlapped the clean build, causing five package
entry-resolution suites to fail while `dist` was absent. This was a verification
ordering error, not a waived test. Completion gates run after the build finishes;
the final results are recorded separately below.

AMOS has no portable remote-transport/session surface. Its existing outcome and
collection displays remain covered; adding a transport UI solely for metadata is
not applicable. The new companion recipe and offline example cover integration.
ICOS adapters/SSE, dependency changes, workflow resume, remote hard budgets, new
backends and publishing are excluded. Literal v2 and legacy behavior remain intact.

## Completion gates and explicit live boundary

Final offline gates pass: 9,085 unit tests, build, typecheck, lint, example
compilation, built-package compatibility, generated API, 90 assertions over nine
mixed ESM/CJS/duplicate-copy combinations and the offline one-submission recovery
example. Checkpoint recovery also preserves acknowledged receipt-only proxy facts;
it never invents a successful proxy observation from admission metadata.

The cumulative live attempt returned 182 passes and 81 failures. Eighty failures
involve Anthropic directly or through cross-provider children/routes: direct models
and messages requests both return HTTP 403 permission_error (account lacks endpoint
permission). One Google legacy wrap-up trajectory did not return the expected
marker; its follow-up skipped the requested read. C7's four OpenAI/Google run/stream
checks passed again after correction. These failures are **not** a full live pass.
The user explicitly instructed “dont test live for now” on 2026-10-28; live testing
is paused and the remaining work proceeds under offline gates. The pending live
checks remain visible in the machine record and handoff, rather than being skipped
and counted as verified. No production credential/account setting was changed.

[Machine evidence](../evaluations/CONSUMER_C7_VALIDATION_2026_10_28.json) records
actual source/build artifacts. Continue C8 under the existing authorization and
current no-live constraint. No release or consumer upgrade has occurred.

Final integration audit: chunked recovery now checks the advertised serialized
record byte count before accumulating multibyte content. Its regression verifies
one chunk only when the local byte quota is too small, then successful explicit
receipt repair without a second submission after capacity is restored. Final
cumulative evidence records the later reviewed source; the earlier C7 totals remain
historical gate results. Live testing stays paused.

## Subsequent holistic review corrections — 2026-10-28

Missing source instrumentation after handing execution to the Agent now yields an
unknown receipt, preserving the write barrier. A supported legacy execute override
may have committed an action before returning or throwing; absence of a captured
outcome cannot establish non-admission. Known rejection before handoff and actual
captured outcomes retain their existing semantics. Stable request deduplication
prevents a lookup/repeated execute from resubmitting the uncertain action.

Receipt lookups serialize reconciliation per invocation, reauthorize every lookup
and reuse an acknowledged observation when the current receipt matches. Repeated
and concurrent reads do not consume new records or re-fetch full remote sources.
Missing/expired proof is repaired from current source evidence; failure leaves the
barrier in place. Queued caller cancellation does not consume a lookup or poison
subsequent repair. Completion errors now release the settled composition lease in
guaranteed cleanup, preserve the close error/idempotency and leave the borrowed
Agent reusable.

Regression coverage includes returning/throwing uninstrumented overrides, one-write
deduplication, exact two-/three-record quotas, concurrent polling/recovery, missing
local proof, cancellation and a throwing completion listener. The runnable recovery
example now verifies concurrent polling reuses evidence. Public/wire signatures,
literal v2 and old loaders/factories/defaults remain unchanged. AMOS has no portable
transport surface to change; its existing adapters are revalidated. Current gates
are in the delivery ledger. No release or consumer adoption is included; live tests
remain paused.
