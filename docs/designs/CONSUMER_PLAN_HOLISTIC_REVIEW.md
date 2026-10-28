# Consumer hardening plan — holistic review and final decisions

- Date: 2026-10-23.
- Baseline: `version2`, `dff238759c41431bd24712d3b045dd38fc800b37`.
- Result: **revision 3 is ready for plan approval**. No runtime implementation,
  consumer change, breaking change or release is included.
- Canonical documents: [delivery plan](CONSUMER_EXECUTION_HARDENING.md) and
  [API design](CONSUMER_COMPATIBLE_APIS.md).
- Validation: [machine record](../evaluations/CONSUMER_PLAN_HOLISTIC_REVIEW_2026_10_23.json).

**Subsequent revision 4:** the [registry follow-up](CONSUMER_REGISTRY_FOLLOWUP.md)
strengthens C6 to return full configuration before initialization, superseding
H09's proposed built-Agent attachment. Its per-operation accounting/ownership
rules remain. It adds independent C9-A/B/C capability, parameter-policy and
presentation work. This document and its machine record describe the revision-3
review. The [final simplicity review](CONSUMER_PLAN_FINAL_SIMPLICITY_REVIEW.md)
owns revision 5; canonical plan/API and C9 constraints reflect its corrections.

## Findings corrected in revision 3

| ID / priority | Problem in revision 2 | Final decision |
| --- | --- | --- |
| H01 / P1 | Optional routine checkpoints promised restart recovery without atomic claim/fencing, action write-ahead semantics or storage acknowledgements. Concurrent/restarted resume could repeat a write. | C3 supports single-use same-process handles with exclusive ownership. Durable workflow restore is deferred C3-R; evidence/context recovery does not pretend to restore a workflow. |
| H02 / P1 | `ExecutionBinding.signal` was described as matching managed-call options, but public `RunOptions` has no signal. Sharing cancellation was also described as never affecting siblings, which is false for a host-shared signal/task. | Preserve public signatures. Use a private invocation-bound bridge under Agent ownership; derive child controllers. Host cancellation can stop the whole operation; child timeout cannot cancel its borrowed task/siblings. |
| H03 / P1 | Verification placement was unclear. Per-task artifact checks could block before an artifact-producing post-step; task success might be mistaken for whole-routine completion. | One phase-aware host verifier, task readiness before dependencies and final artifact verification after post-steps. Required verification, managed verdict, reflection quality and warning states have explicit precedence. |
| H04 / P1 | Routine-tool teardown could destroy an owned child when returning waiting; continuation had no complete lease/close/concurrent-use contract. | Retain child and lease across waiting; atomically claim handles; renew authorization; terminal cleanup once. Close requests cancellation without claiming uncooperative effects stopped. Model results never expose continuation capabilities. |
| H05 / P1 | Remote transport completion, server effect outcome and client cancellation were insufficiently separated. An HTTP abort cannot establish server cancellation. | Separate proxy/server observations; explicit negotiate/execute/getReceipt/cancel/readEvidence semantics. Unknown receipt is never replay permission. Old v2 DTOs/types remain intact. |
| H06 / P2 | Failure reporter association depended on unspecified wrapping, while actual managers/account wrappers replace execute functions and clone contexts. | Admission captures the new callback capability; official wrappers preserve an explicit private bridge. No result/context identity or new ambient execution scope. First report/settlement/late rules and cross-module gates are explicit. |
| H07 / P2 | New runner duplicated legacy mode, loosely accepted old settings and did not specify task retry/post-step rules. | One verified facade; legacy callers keep old runner. Whole-definition preflight, supported-option map, one outer submission, explicit rejection of unsupported dynamic/parallel/replay settings. No action before preflight. |
| H08 / P2 | Connector design added a second public factory registry and vague `contracts` strings; unread-tail recovery risked a stateful cursor database and tool reconstruction could invalidate live traversal. | Private fixed profile manifest and clear names. Whole provider pages, separate coverage/exhaustion and authenticated ephemeral cursors owned by the current manager/context across catalog reload. No public registry, tail store or LLM call required per page. |
| H09 / P2 | Orchestrator constructor captured live task/signal even though the returned Agent can serve many later operations. Factory ownership and async behavior were underspecified. | Fresh idle Agent factory with detached containers/retained host handles, validated attachment/rollback. Bind supplied task per parent operation; creation descriptions have a separate one-call binding. Quarantine abandoned workers. |
| H10 / P2 | New universal inspector overlapped existing inspection and proposed another composition registry. Remote `restore...` naming did not match actual hydration APIs. | Remove universal inspector; use existing reports plus operation-owned views/child observer. Use `hydrateAgentPackageWithOutcomes()` alongside existing `hydrateAgentPackage()`. |
| H11 / P2 | Dependencies made connector hardening wait for routines and remote parity wait for worker construction, although neither dependency is required. | C4 depends on C1; C6 on C1/C2; C7 on C1/C4. C8 tests begin in C1. C2/C3 share one public facade release boundary. |
| H12 / P2 | Core API examples were illustrative but uncompiled, and several behavior choices were deferred ambiguously despite presenting the plan for approval. | Add compile-only declarations/positive and negative examples against the built public package. Pin core semantics and exclusions now; C7 exact wire schema remains an explicit stage-entry deliverable, outside implicit API approval. |

These are corrected plan/design findings, not claims that the underlying consumer
gaps have been fixed. The original 17 characterization cases intentionally retain
legacy behavior. Their selected-path counterparts are mandatory during implementation.

## Source checks that determined the design

- [Agent RunOptions and cancellation](../../src/core/Agent.ts): managed-call options
  do not have a signal; Agent cancellation owns an execution/controller. The new
  path must not pass ignored arguments or cancel another caller's Agent.
- [ToolManager admission](../../src/core/ToolManager.ts),
  [pipeline](../../src/core/tool-execution/ToolExecutionPipeline.ts) and
  [connector account wrapper](../../src/tools/connector/ConnectorTools.ts): per-call
  context plus multiple execute/context wrappers rule out naive identity mapping.
- [Task defaults](../../src/domain/entities/Task.ts) and
  [routine runner](../../src/core/routineRunner.ts): legacy task attempts default
  to three and post-steps have their own terminal behavior. Preserve these on the
  old entry point; make selected verified-path semantics explicit.
- [Routine storage](../../src/domain/interfaces/IRoutineExecutionStorage.ts): audit
  methods do not establish workflow CAS/leases/fencing or resumable executable state.
- [Package types](../../src/portable/types.ts) and
  [exports](../../src/portable/index.ts): literal v2 and exact public hydration
  vocabulary must stay intact; new metadata cannot enter an old strict parser.

## Simplifications and scope limits

The final plan adds small selected facades over existing engines. It does not add
an alternative ToolManager, context manager, workflow engine, public factory
registration framework, universal inspector or durable cursor database. C3 has
one required verifier and one result model, with old completion behavior left on
the old entry point. Shared accounting stays explicit and process-local.

Deferred work is deliberate and separately named: durable routine resume C3-R,
cross-process cursor codecs, production backend design, distributed hard-budget
authority, Stage 14B/16B and other conditional roadmap extensions. Safe evidence
recovery/reconciliation remains required in the included scope; automatic uncertain
write replay is never a substitute for deferred recovery facilities.

No new test-runner dependency belongs in production runtime exports. C8's reusable
conformance harness must be runner-independent (for example, built-in assertions)
and test-only, while preserving existing storage adapters and root import behavior.
Detailed packaging is settled in that delivering slice; no new database is selected.

## Verification and approval boundary

Fresh focused tests, the legacy built-package consumer, public ESM/CJS controls,
17 characterization cases and compile-only API declarations are recorded in the
linked machine record. The contract prototype validates type coherence and catches
unsupported old options; it is not a runtime implementation or a proof of new
behavior. Full/live delivery gates remain mandatory in their implementation slices.

The original investigation record retains revision-2 document hashes as historical
evidence. The new holistic record owns revision-3 document/type-fixture hashes;
runtime source remains unchanged. No historical full/live result is recounted as fresh.

Approve the revised roadmap, core API direction, explicit exclusions and paired
legacy/new acceptance gates. Implementation still begins with a separately selected
slice, recommended C1. C7's exact wire schema requires its stage-entry review; no
breaking old API, altered default or automatic migration is an approval option.
