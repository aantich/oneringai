# Evidence conformance and composed guarantees

C8 adds test/example infrastructure, not a production backend or a new inspector.
The reusable runner-independent harness is `tests/conformance/evidence.ts`.
`runEvidenceConformance(profile)` accepts a scoped adapter factory and declared
acknowledgement strength, with optional same-backend reopening. It uses Node
assertions and no test-runner imports. It is not exported or eagerly imported by
the production package. Existing adapter-specific tests remain.

Supported tested profiles are the existing process-local `InMemoryEvidenceStorage`,
`FileEvidenceStorage` restart acknowledgement and file fsync acknowledgement. The
harness checks immutable admission/read copies, exact bounded UTF-16 reconstruction,
source hashes, corrupt references, tenant isolation, expiration/deletion/pruning,
quota admission and concurrent immutable writes. Reopening an in-memory store is
not restart support. Local fsync does not establish replicated durability. No shared
Mongo/SQL backend profile has been delivered or claimed.

`tests/fixtures/composition-evaluation/restart.mjs` runs as two actual Node processes.
The producer stores remote source and proxy observations, then exits. Recovery uses
the same scoped file backend, restores exact quoted data and proxy failure, denies
unauthorized access, and observes a new server epoch as unknown. It preserves one
synthetic submission and refuses replay. Evidence recovery does not restore a
routine continuation, live ModelTask, authority or workflow cursor.

Run `npm run example:composition-evaluation` for six local/remote meeting workflows
with development and held-out data. Each reads exact source, submits once, waits for
host confirmation and produces a temporary artifact checked against the source.
The model's acknowledgement and accepted submission are insufficient for completion.
Rejected continuation authorization performs no work. Artifacts are deleted during
cleanup. The example reuses the existing canonical baseline reporter utility and
ordinary public APIs. Reported latency is a synthetic functional observation, not
a comparative quality/performance claim. Known model cost subtotal, unknown model
pricing and unknown external costs remain separate; missing cost is never zero.

Existing C3–C7 tests remain the authority for uncertain writes, cancellation and late
children, long-source projection/compaction, complete pagination and connector scope.
C8 runs those suites alongside the new composed and child-process cases. The stable
collection fixture includes empty pages, unread tails and a final partial page.
Do not infer corpus coverage from returned count or provider pagination end.

For inspection, compose `agent.inspectCapabilities()`, runtime inspection, C3
`runner.inspect(operationId)`, C6 child observers, C7 `session.inspect()` and explicit
ModelTask snapshots. Old report shapes are unchanged. Configured host checks are
separate from observed host verification. Managed, direct, Realtime and external
loops keep their existing owners. Remote observations do not prove business
completion; compaction/cancellation support is not proof an external write stopped.
Unknown/custom support stays unknown. There is no universal execution registry.

AMOS `/routine inspect` displays observed verification, accounting binding, recorded
call count or unknown, and same-process continuation limits. Run
`npm run example:amos-composition` for its offline actual-command demonstration.
No new voice/remote transport UI is introduced. ICOS adoption, releases, new database
adapters and durable workflow resume remain separate work. Live LLM testing is
paused at the user's request as of 2026-10-28.
