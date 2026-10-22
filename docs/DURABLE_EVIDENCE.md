# Durable tool evidence (Stage 03)

Implemented in the `version2` development branch; no package release is claimed.
Evidence is opt-in. Existing tool returns, defaults, execution plugins, and older
saved sessions continue to work without enabling it.

All three corrective passes are validated. The
[third corrective completion](./designs/STAGE_03_THIRD_REVIEW.md#corrective-completion--2026-10-14)
records partial-batch retention on early exits, receipt-only admission protection,
and restoration across acknowledgement changes. Final local, OpenAI/Anthropic/Google
recovery, public compatibility, examples and AMOS gates pass; earlier failures and
provider diagnostic limitations remain in the validation record.

All first- and second-review corrections are validated. The
[second review completion](./designs/STAGE_03_SECOND_REVIEW.md#corrective-completion--2026-10-14)
records protected input replacement, optional-outcome correlation and pending-result
session snapshots, with local and real-provider recovery checks.

The [Stage 03 review](./designs/STAGE_03_REVIEW_AND_FIX_PLAN.md) records the original
six findings and their corrective validation. Review reproductions remain
historical evidence, separate from the later completion results.

## Configure a managed agent

Use an existing named connector for model authentication. Evidence stores do not
receive connector credentials or an executable connector registry.

```typescript
import { Agent, FileEvidenceStorage } from '@everworker/oneringai';
import type { ToolFunction } from '@everworker/oneringai';

const storage = new FileEvidenceStorage({
  directory: './data/evidence',
  scope: { ownerId: 'user-123', tenantId: 'acme', namespace: 'research-task' },
});
const search: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'search_documents',
      description: 'Search application documents.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  execute: async () => ({
    status: 'found', ids: ['DOC_17'], body: 'Large source text. '.repeat(1000),
  }),
  output: {
    effect: 'read',
    expectedSize: 'large',
    summarize: value => {
      const result = value as { status: string; ids: string[] };
      return JSON.stringify({ status: result.status, ids: result.ids });
    },
  },
};
const agent = Agent.create({
  connector: 'openai-main', // Already configured through Connector.create().
  model: 'gpt-4o-mini', userId: 'user-123', tools: [search],
  context: {
    model: 'gpt-4o-mini', features: { evidence: true },
    plugins: { evidence: { storage } },
  },
});
try {
  const response = await agent.run('Search documents and inspect exact source when needed.');
  console.log(response.output_text);
} finally { agent.destroy(); }
```

`agent.tools === agent.context.tools`. The plugin attaches post-settlement
middleware to that same manager. It adds `evidence_read` and `evidence_list`, plus
a bounded, metadata-only recent receipt index. Disabled evidence adds neither
prompt content nor retrieval tools and never resolves the evidence factory.
A pre-existing external `PluginRegistry` registration using feature key `evidence`
retains precedence; the built-in feature does not replace that extension.

Alternatively configure `StorageRegistry.configure({ evidence: (scope, context) =>
new FileEvidenceStorage({ directory: './data/evidence', scope }) })`. The optional
factory receives host-owned scope and the existing `StorageContext`. Explicit
plugin storage takes precedence. Explicit `plugins.evidence.scope` must agree
with the store's scope. Without a scope/store, owner defaults to context userId
(or agentId), namespace to agentId, and the default is a **new process-local
InMemoryEvidenceStorage instance**. Stable cross-restart scopes and a durable
backend must be configured deliberately. Share an in-memory instance explicitly
for in-process resumption; saved references do not recreate its data.

## What is recorded and projected

The store captures the final raw ToolManager result after existing execution
plugins, before evidence projection. Version-1 observations include original
execution/call/run correlation, tool and connector names, dispatched arguments,
trusted user/account/agent identity, timestamps, host-declared effect classification,
execution status, completion/cancellation metadata, and a JSON result when available.
Bound connector accounts take precedence over shared account bindings. Identity
and ownership never come from model-controlled arguments. `output.effect` defaults
to `unknown`; it does not infer a write from a tool name or permission risk level.

All ordinary calls through the configured manager get evidence handling, including
semantic failures and denials. The names `evidence_read` and `evidence_list` are reserved with this middleware
and excluded from capture to avoid recording retrieval reads. Missing or disabled tool admissions still use
the existing errors; there is no invented execution receipt for a nonexistent tool.
Legacy `execute()` overrides that bypass the standard manager also bypass this
middleware. Existing third-party execution plugins retain their transformation
contracts; evidence cannot recover data those plugins already discarded.

Projection requires both an acknowledged record and `output.summarize`, and the
redacted JSON result must reach `projectThresholdBytes`. `expectedSize` is advisory;
it does not itself discard content. Small/unhinted results remain raw. The
synchronous, pure summarizer receives a detached redacted copy and must preserve
all essential business status and identifiers. The envelope separately preserves
framework status, completion, effect, call ID, and the complete evidence reference.
An empty, throwing, asynchronous, or excessive summary falls back to raw output.
There is no automatic summarizer-model call in Stage 03.

- `execute()` returns the same raw application value.
- `executeWithOutcome()` adds optional `evidence` delivery metadata.
- `ToolExecutionOutcome.evidence` contains storage diagnostics and a reference,
  never the projection or source blob. Its execution `status` remains independent.
- `ToolExecutionOptions.onEvidence` observes delivery; observer failures are isolated.
- Managed `ToolResult.content`, `tool:complete`, and streamed execution results stay
  raw. Only the context's model-facing view uses the authenticated projection.
- Host after-tool content changes supersede the old projection, including nested
  in-place mutations and direct result replacement. Projections are bound to the
  captured source digest; raw object identity and mutable hook behavior remain intact.
- Native async delivery also uses acknowledged projections. Late results following
  cancellation remain diagnostic-only and retain their original correlation.
- `runDirect()`/`streamDirect()` do not run a managed tool loop; evidence does not
  introduce one or add hidden model calls.

## Read, persist, and inspect

`EvidenceReference` contains version, UUID, SHA-256, byte size, and acknowledgement
strength. It is scoped to the configured store, not a filesystem path or an
unrestricted URL. A reference is an identifier, not permission to access another
owner's data. File scope directories use hashes of exact scope fields, avoiding
case/punctuation sanitization collisions.

The model calls `evidence_read({ id, offset, limit })` with the scoped UUID from
`evidence.id`; storage resolves and checks integrity metadata. Full-reference
`evidence_read({ reference, offset, limit })` remains supported. Supply exactly one
selector. Chunks contain serialized record JSON; offsets count UTF-16 characters,
and `nextOffset` supplies the next boundary. Concatenating chunk text reconstructs
the exact stored JSON, including Unicode. Reads verify the complete bounded blob's
size/hash before returning any source content. `evidence_list` returns bounded
metadata pages, with `next` supplied as the next request's `after` cursor. It
includes no source result or arguments. Optional host `getReference(id, signal?)` resolves metadata without asking a model
to reproduce hashes/byte counts; bundled adapters implement it efficiently. Custom
stores can omit it: the plugin falls back to at most ten metadata pages of 100 entries
and fails explicitly if that lookup budget is exhausted. Host `readRecord(reference)` returns a
detached complete JSON record, bounded by the record-size limit.

Save/load uses existing context APIs. The evidence plugin snapshot is versioned
and contains only its scope and bounded recent diagnostics; tool-result content
has optional versioned evidence metadata. Configuration, storage instances,
credentials, redaction code and executable summarizers are not restored from a
snapshot. Scope mismatches and unsupported snapshot versions fail explicitly.
Lowering the recent-index limit truncates a valid older index; omitted records
remain discoverable through listing. Older sessions need no evidence fields.
The complete evidence snapshot is preflighted before conversation, system prompt
or any plugin state changes. Invalid same-scope receipts fail without partially
installing the rejected context, just as foreign scopes and unsupported versions do.

An authentic `ToolResult.evidence` delivery carries original execution/call/scope
correlation internally; `ToolResult.outcome` remains optional. Copies or invented
deliveries cannot authorize projection or substitute for that internal correlation.
When a matching authentic delivery includes a stored result, it owns its receipt
even if the optional outcome conflicts. A receipt-only delivery remains a valid
diagnostic, but cannot authorize removal of raw result content. Context admission
keeps that content protected, and async continuation pauses until result-bearing
recovery. Result presence is private provenance; no public field becomes required.
Context admission also checks the delivery's scope and supplied call ID.

Pending unacknowledged results are included in a detached `conversation` snapshot
by `getState()`, `save()` and Agent session saves. Saving does not commit live input
or make a model/tool call. Older session schemas need no new field. Same-instance
load/restore reconciles versioned results by function/custom namespace, call ID
and execution ID. The loaded checkpoint owns matching invocations even if a live
receipt was acknowledged after the checkpoint; an older failed receipt restores
its protection and can be acknowledged again with the stored observation. Unrelated
pending content stays intact. Older metadata without execution IDs keeps the
exact-copy fallback. New input, including async insertion or a follow-up run,
commits the whole protected pending group before replacing it. Intentional host
clearing/destruction remains explicit; saving does not create crash-resumable tool
execution or change the evidence backend's acknowledgement strength.

Completed unacknowledged results are retained before cleanup when a consumer
closes streaming at tool completion or a later tool causes a fail-fast exit.
Partial batches preserve their call/result correlation and opaque provider state;
normal completion commits once. No additional tool/model request runs to retain
or recover that observation. The [stream interruption example](../examples/evidence-stream-interruption.ts)
demonstrates closure, receipt-only admission rejection, checkpoint restoration
after acknowledgement, and exact recovery with one local action execution.

Scratch eviction, context compaction/rollover, agent destruction and session deletion
do not delete evidence. Retention/deletion are separate explicit host operations:
`delete(reference)` and `pruneExpired()`. Expired records return missing and are
omitted from lists; they still consume storage until pruned. References may become
unavailable after host retention/deletion. Do not invent missing source contents.

## Defaults and durability boundaries

| Setting | Default / behavior |
| --- | --- |
| Feature | Disabled |
| Unconfigured enabled store | New in-memory instance; process lifetime only |
| File acknowledgement | `restart`: atomic rename, ordinary process restart |
| Optional file `fsync` | File and containing/ancestor directory synchronization before acknowledgement; filesystem-dependent local crash durability |
| Distributed durability | Not supplied by either bundled adapter |
| Record/scope capacity | 4 MiB per blob; 64 MiB and 1000 records per scope |
| Read capacity | 8192 characters/chunk; 8 simultaneous reads per instance |
| Mutation admission | 32 queued mutations per scope in this process |
| Listing | 20 entries by default; maximum 100 per page |
| Prompt/snapshot index | 20 recent receipts; configurable maximum 100 |
| Projection | Threshold 8192 JSON bytes; summary cap 2000 characters; envelope cap 4096 characters |
| Acknowledgement deadline | 5000 ms; late acknowledgements cannot authorize projection |
| Retention | No expiry unless `retentionMs` is configured |

Bundled stores fail at capacity; they never evict evidence to make room. File
mutations coordinate admission across instances using the same configured absolute directory/scope in one Node
process. Different path aliases require host coordination. Multiple
writer processes need host coordination or a transactional custom backend; no
distributed lock or budget is provided. Read slots fail with `EvidenceError('busy')`
rather than creating an unbounded queue. File reads allocate at most the configured
blob limit plus one byte and reject corrupt/oversized files. Records are immutable;
there is no separate unbounded index or append-only scan of historical updates.

Bundled stores also expose the optional `serializationLimitBytes` capacity hint.
Middleware inherits this effective record/scope byte cap and checks dispatched
arguments, source/result cloning, host-redaction output and the combined observation
before storage. Incremental UTF-8 encoding rejects excess bytes/work while traversing
the value, before constructing the complete expanded JSON. Quoted strings, Unicode,
escaping, scope and integrity wrapper bytes count toward their relevant limits.
Mutation admission precedes expensive capture, while admitted inputs are captured
synchronously so later caller mutation cannot change queued records.

`maxSerializationBytes` optionally sets the middleware's pre-storage budget. A host
that deliberately redacts a larger source into a smaller stored result can supply a
larger source budget; the backend still enforces its final blob quota. For example:

```typescript
plugins: { evidence: { storage, maxSerializationBytes: 8 * 1024 * 1024 } }
```

Custom adapters need no new required property or method. Without a capacity hint
or explicit `maxSerializationBytes`, their existing capacity behavior remains in
effect; configure a budget or expose the optional hint for bounded middleware
capture. Host callbacks must still obey their synchronous contracts; byte/work
bounds do not impose a wall-clock deadline on arbitrary host code.

An awaited history-journal append is not an evidence acknowledgement. The existing
journal skips malformed records and has different write/read contracts, so Stage 03
uses the registry and file conventions without claiming journal durability. File
enumeration and ID discovery report conservative `restart` references; it cannot reconstruct proof
that an originating writer returned an fsync acknowledgement. Reading an original
reference preserves its reported strength and never upgrades it because a later
reader has stronger settings. Neither hashes nor fsync provide replica durability.

## Failure and recovery

Evidence storage failure is distinct from tool-effect failure. A successful write
stays successful even if evidence storage is unavailable, serialization fails, or
a summarizer throws. No evidence error enters the execution retry/circuit pipeline.
Never repeat an action to recreate a missing result. Custom backends must return
references only after their documented acknowledgement and honor ownership,
immutability, integrity, limits, and redaction contracts.

If storage fails, the raw application return remains available. A fitting managed
request can still use it, but its persisted call/result group is protected against
compaction, scratch spill, emergency truncation and semantic rollover. If it cannot
fit, dispatch fails explicitly while retaining the raw copy. Native async continuation
with failed storage stops before injecting a lossy text message; its raw completion
remains available to the host. Cancellation/timeout receipts with `completion: unknown`
remain unresolved; a later settled observation is a separate record, never a rewrite
of the original receipt or proof that an external workflow was undone/completed.
Cancellation during fulfillment still persists the settled returned observation;
it does not authorize projection delivery or change the cancellation outcome.

After repairing storage, persist the retained result without executing the tool:

```typescript
import { ToolEvidenceMiddleware } from '@everworker/oneringai';
// report is the retained executeWithOutcome() report; tool/args/context are host-owned.
const recovery = await new ToolEvidenceMiddleware({ storage }).record(
  search, {}, { userId: 'user-123' }, report.outcome, { value: report.result },
);
if (recovery.reference) {
  await agent.context.acknowledgeToolEvidence(report.outcome.callId!, recovery.reference);
}
```

`acknowledgeToolEvidence()` is host-only and matches the original invocation/call,
checks the stored record, rejects concurrent context/identity changes, and updates
only the acknowledgement metadata. It leaves raw content unchanged and allows later
compaction. For explicitly supplied async results, the host can replace the result's
`evidence` and `outcome.evidence` with the recovered metadata before continuation.
Acknowledgement requires a stored result property; a receipt containing only status
cannot release raw-result protection. Known retained tool names must also match.
Intentional host redaction, including an explicit `null` result, remains supported.

Native queued async results remain queued when evidence blocks delivery. Automatic
continuation pauses rather than retrying the blocked batch. Retain the public
`async:tool:complete` result object, store its observation after repair, replace its
`evidence` and `outcome.evidence` with the recovered metadata, then explicitly call
`agent.continueWithAsyncResults()`. No tool is executed again. Current undelivered
entries also survive pre-injection host errors; cancellation/identity invalidation
can remove their delivery eligibility. Results already inserted into context are
consumed once, including when a later observer throws.
Historical execution receipts can still show the original storage failure; the
new record is discoverable via listing. No automatic recovery, replay, deduplication,
transaction guarantee, or crash-resumable external write is claimed; conditional
Stage 11 owns that scope.

Framework connector/auth objects are excluded. Common credential keys are redacted
recursively before storage, including API-key/authorization/token/password/secret
headers. Synchronous `redact(value, kind)` applies host policy to arguments/results; credential
key redaction is applied again afterward. Invalid async policy results fail storage
without an unhandled rejection; evidence observers also contain async rejections. Arbitrary sensitive strings/source content
require that host policy; this is not a universal secret detector. File storage is
JSON on the host filesystem, not encrypted storage. Configure appropriate host
permissions, encryption and retention for the data being retained. Non-JSON values
(cycles, functions, BigInt, non-finite numbers, class instances, sparse arrays,
accessors/toJSON) fail evidence storage without changing the tool's raw contract.

## Runnable validation

After `npm run build`:

```bash
npm run example:durable-evidence
npm run example:evidence-recovery
npm run example:ambiguous-evidence
npm run example:amos-evidence
npm run test:agentic:compat
# Opt-in, billable calls using .env:
npm run test:evidence:live
```

The durable example projects a large synthetic search result, evicts scratch,
rolls over history, saves/loads context and retrieves exact data in a separate Node
process. The ambiguous-action example applies one local simulated write, loses its
response and preserves an unresolved receipt without retrying. All examples clean
their temporary resources and need no credentials/network. Live probes exercise
OpenAI, Anthropic and Google run/stream retrieval plus storage-failure raw fallback;
they do not estimate reliability or claim model-quality/cost improvements.

## Native compaction source retention (Stage 16A)

The optional native history strategy archives each replaced prefix as an exact
scoped `__context_source__` record and verifies its acknowledgement before swapping
history. Redaction, quota, loss or mismatch preserves the original history. Older
settled action exchanges need matching acknowledged evidence; pending/unknown or
unstored results stay protected. Native checkpoint source references remain subject
to backend retention; missing proofs stop resume/use until host recovery. Configure
a restart-capable backend explicitly and keep trusted pre-native checkpoints where
needed. This never authorizes repeating an external action. See the
[native guide](NATIVE_CONTEXT_COMPACTION.md).
