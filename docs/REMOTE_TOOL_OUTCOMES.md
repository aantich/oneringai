# Negotiated remote tool outcomes

Branch availability: opt-in C7. No package release or consumer upgrade is implied.
The old `AgentPackageToolServer`, transport, DTOs, classification and literal
`AGENT_PACKAGE_PROTOCOL_VERSION = 2` remain unchanged.

Use `AgentPackageOutcomeServer(sourceAgent, legacyPackage, { storage, authorize })`
and `server.package()` to create a separate `OutcomeAgentPackage` envelope with
protocol `oneringai.tool-outcomes/1`. Call `hydrateAgentPackageWithOutcomes` with
ordinary trusted hydration options, an enabled evidence plugin and authenticated
`RemoteOutcomeTransport`; it returns `{ agent, session }`. Old loaders reject the
new envelope. Negotiation failure never falls back to old execution.

The host implements five transport methods by adapting its authenticated channel:
`negotiate`, `execute`, `getReceipt`, `cancel`, `readEvidence`. The server requires
trusted host context separately on every method, rechecks authorization for cached
results and each chunk, and derives effects and executable contracts from actual
source registrations. A package, request ID, fingerprint or reference grants no
authority. Do not pass model-selected tenant identity as trusted host context.
Keep the server alive until source work settles; `await server.close()` waits for
raw work and completes the ordinary external Agent lifecycle. It does not destroy
the borrowed source Agent, transport, storage or ModelTask.
If completion hooks/listeners fail, `close()` preserves that error and still releases
the settled composition lease, so the borrowed Agent can be reused. Repeated close
calls share the same completion/error.

For C6 or tools-first construction, await `createAgentPackageOutcomeTools(envelope,
{ transport, storage })`. Put its `tools` and the **same storage object** in the
ordinary Agent/factory configuration with evidence enabled. A session owns one
manager. Create a fresh toolset for another Agent or scoped child. Use
`session.checkpoint(agent)` in this path; the hydration convenience also permits
`session.checkpoint()`.

`agent.tools` is still `agent.context.tools`. Actual proxy and server outcomes stay
separate in `session.inspect()`: IDs, timing, cancellation and local completion are
not rewritten. Business `success: false` remains data. C1 owning operational failures
remain failures. The ordinary result normalizer still handles null/undefined tool
returns; a null JSON field and wire result-presence flag remain lossless.

Before action submission, an acknowledged admission record binds the actual proxy
invocation to the request/session and canonical argument fingerprint. Full local
observations are stored as `oneringai.remote-observation/1` in existing
`EvidenceRecord.result`, with the admission reference, actual proxy outcome,
validated remote receipt and complete payload. Server source records use
`oneringai.remote-source/1`. Backend schemas and old session/event shapes do not
change. Host redaction must preserve required correlation fields; otherwise the
source remains unacknowledged. Raw tool returns/events retain their normal shape.

An unknown remote write/unknown effect blocks further managed model/action dispatch,
even without loop-policy configuration. Reconcile with
`await session.getReceipt(operationId)`, which retrieves full acknowledged source,
stores a local observation and acknowledges matching retained context evidence.
It never resubmits the action.
Unchanged receipt lookups reuse a validated local observation instead of consuming
another evidence record or re-fetching the full remote source. Concurrent lookups
serialize reconciliation for that invocation and each still uses the authenticated
receipt transport. A missing/expired local observation can be repaired without
resubmission; a failed repair keeps the action barrier in place.
Legacy `ToolManager.execute` overrides that bypass outcome instrumentation remain
supported on their original path. On this negotiated path, missing authoritative
metadata after execution handoff means **unknown**, even when the override returns
or throws. It cannot establish non-admission, success or a safe retry. Use an
instrumented source pipeline for reconcilable server observations.

A transport abort does not prove server cancellation;
`session.cancel(id)` requests per-invocation cancellation. Late results retain the
original identity. Cancelling one source call does not cancel siblings or a borrowed
task. `session.close()` closes local admission without claiming remote rollback.

Inline results default to 64 KiB, configurable through `maxInlineBytes` (zero forces
references, maximum 1 MB). Evidence is read in exact bounded chunks with a separate
content digest: a backend reference hashes its storage blob, which may include
scope/encoding overhead. Configure `maxReadChars` no larger than the selected
backend's read limit. Source/backend and local serialization quotas still apply.
If source storage fails, the server retains the exact record and rejects new
admissions. Host-only `readRetainedSource(id)` and `acknowledgeSource(id, ref)` repair
it after storage succeeds; the action is not repeated. Oversized non-JSON sources
require host repair and remain explicit failures, never prefix-truncated results.

Process-local request deduplication keeps identities through settlement; capacity
(default/maximum 1000 distinct requests) rejects new admissions instead of evicting
active authority. `session.inspect(id?)` is detached, bounded metadata and performs
no IO. Observers are isolated. Accounting is explicitly `external_unknown`; no
remote live task/budget is serialized or silently charged as local model usage.

Checkpoints store references and metadata, not credentials, callbacks, workflow
cursors or task authority. Loading verifies admission/full-observation proof against
the owning scoped backend. A restarted source can return unknown for an old epoch;
that does not authorize replay. Use `FileEvidenceStorage` for actual restart
recovery; an in-memory backend is process-local. The host must reauthorize recovery.

Run `npm run example:remote-outcomes` for the offline authenticated transport demo
(read, declined business data, uncertain synthetic write, exact recovery, one
submission). `RUN_REMOTE_OUTCOMES_LIVE=1 npx vitest run
tests/integration/text/RemoteOutcomes.live.integration.test.ts` opts into billable
OpenAI/Anthropic/Google run/stream checks using `.env`.
