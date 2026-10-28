# C8 — evidence conformance and composed evaluation

Stage-entry design under sequential authorization (2026-10-28). Implementation
starts after C7's completion gate. No production backend or workflow engine is added.

## Selected scope and interfaces

Reuse `Agent.inspectCapabilities()`, runtime inspection, C3 operation reports,
C6 `onChildOutcome`, C7 `session.inspect()` and ModelTask snapshots. The example
assembles a host-owned diagnostic view distinguishing configuration, actual host
verification, source/proxy settlement and known/unknown accounting. Existing
inspection shapes remain unchanged; no global inspector or registry is introduced.

A runner-independent test-only `runEvidenceConformance(profile)` accepts an adapter
factory, declared durability, optional reopening factory and cleanup. It covers
acknowledgement, immutable input capture, bounded exact reconstruction, corrupted
references, scope isolation, expiration/deletion, quotas and concurrent writes.
Use existing in-memory and file stores. A real child process reads file-backed C7
checkpoint/source proof after the producer exits, reauthorizes it and demonstrates
unknown workflow authority without action replay. Adapter-specific tests remain.
No eager test dependency is exported by the production package.

Extend the existing baseline evaluation utilities with composed, held-out synthetic
workloads and reuse its canonical hashing/reporting. Test routine verification and
same-process continuation, uncertain source writes, local/remote outcome parity,
parent/child cancellation and late correlation, exact evidence after context
reduction, complete pagination and restart/reauthorization. Existing per-slice
fixtures supply the difficult lifecycle cases; acceptance additionally runs a
meeting-preparation composition through actual public APIs. Its local artifact and
citations require explicit host verification. Zero false verified completions,
duplicate writes and unauthorized disclosures are required. Report sample counts,
source hashes, redundant calls, latency quantiles and unknown whole-operation costs;
no quality/latency/cost improvement is inferred from smaller prompts.

AMOS receives an offline diagnostic demonstration using the same host-owned view;
its default behavior and current commands stay intact. Update Version 2, supported
matrix, standard usage docs and delivery/machine evidence. Database adapters,
production deployments, ICOS upgrades and durable workflow resume remain excluded.

## Review and delivery

The harness and all three current profiles are implemented. A real two-process C7
file recovery test verifies exact source and proxy facts, reauthorization, one
submission and explicit unknown workflow state. The composed acceptance utility
reuses baseline canonical hashing and the existing offline connector; six example
samples and four held-out unit samples cover actual public local/remote APIs,
C3 waiting/authorized continuation, shared model accounting and artifact validation.
The broader review sweep includes C3/C5/C6/C7 and all evidence adapter/lifecycle tests.

Review corrected fsync profile construction to use the existing `durability`
option, and separated unknown model pricing from the known cost subtotal. The
AMOS command reports unavailable independent call counts as unknown. There is no
new production inspection surface, backend, global journal, or testing dependency.
Existing source/proxy and inspection return shapes remain unchanged.

Final gates: all 9,090 units pass, the 369-case focused review passes, three backend
profiles execute 596 conformance assertions across 267 exact-read pages, two real
processes verify restart/reauthorization, six composed example samples pass and the
actual AMOS command demo passes. Example compilation passes. Production root code
and public types are unchanged from C7's passing build/type/lint/compatibility
artifacts. The full-suite review found a teardown race with the existing
fire-and-forget journal; bounded filesystem cleanup retries and unconditional
connector cleanup fix the race and its cascading duplicate-connector failure.
[Machine evidence](../evaluations/CONSUMER_C8_VALIDATION_2026_10_28.json) includes
source hashes, measured synthetic latencies and explicit unknown cost counters.
No live calls were made for C8, as requested. Proceed to C9-A.

Final packaging audit also includes the reused reporter helper in the published
file inventory and narrows it to its structural event subscription contract. This
avoids a source-versus-built Agent nominal type dependency while keeping the
runner-independent reporting utility and public examples reusable. Final package
closure and frozen example/type checks are recorded in cumulative evidence.
