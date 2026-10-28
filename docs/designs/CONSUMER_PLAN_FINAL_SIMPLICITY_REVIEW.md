# Consumer plan — final simplicity and regression review

- Date: 2026-10-23; **revision 5, ready for plan approval**.
- Baseline: `version2`, `dff238759c41431bd24712d3b045dd38fc800b37`.
- Scope: review and documentation only. Proposed APIs are not implemented.
- Subsequent decision: the user approved this direction and selected C1 with
  “proceed with full implementation”; see [C1 delivery](CONSUMER_C1_DELIVERY.md).
  Review totals/hashes below describe the earlier planning checkpoint.
- Current sources of truth: [delivery plan](CONSUMER_EXECUTION_HARDENING.md),
  [API contracts](CONSUMER_COMPATIBLE_APIS.md),
  [C9 constraints/provider evidence](CONSUMER_REGISTRY_FOLLOWUP.md).
- Fresh validation: [machine record](../evaluations/CONSUMER_PLAN_FINAL_SIMPLICITY_REVIEW_2026_10_23.json).

The staged direction is sound after these corrections. Keep the existing engines,
add explicitly selected surfaces, and freeze legacy behavior. No second workflow,
tool, context, registry or authorization platform is needed. The additional report
does not justify merging all remaining work into one implementation stage.

## Findings resolved in the plan

| ID / priority | Risk in revision 4 | Revision-5 decision |
| --- | --- | --- |
| D01 / P2 | Cancellation text treated direct calls like managed calls, implying unnecessary private plumbing. A routine lease also did not explain direct-call admission. | Reuse existing DirectCallOptions signal/modelTask. Private cancellation bridge only for managed run/stream. Selected composition guards Agent/direct/maintenance admission; it does not revoke independently held context/connector references or change ordinary direct concurrency. |
| D02 / P1 | Returning enhanced tools does not suppress identity-generated legacy tools, tag connector source, or update cached catalog definitions. A model could still select an unhardened alias. | Static recipe uses real enhanced-name identity filters, catalog disabled, and existing registerConnectorTools. Require exact enabled-definition/source/account assertions. C5 separately gates manager-local profile-aware catalog discovery/load/cache/scoping; no global factory replacement. |
| D03 / P1 | Full C6 config exposes overlapping Agent/context identities and tool channels. Shared workspace was described beside isolated child authority without stating that its contents are shared. Blanket scope uniqueness could reject intentional shared evidence/tasks. | One canonical ownership table. Reject conflicting identity copies; use ordinary timeout/storage precedence and collision checks. Unique live conversations, explicit shared evidence/backend/task scopes allowed. Returning authorized worker config admits it to the shared board; host controls membership/content. No new tenant/policy engine. |
| D04 / P1 | A single-use continuation could be consumed before asynchronous authorization/binding checks succeed, leaving no handle to a retained lease. | One private operation state serializes admission. Failed/throwing authorization, pre-admission cancellation or bad binding starts no work and keeps the paused handle usable. Successful admission consumes it; another wait yields one successor. Preserve correlated recovery and no effect replay. |
| D05 / P2 | Each phase/report could copy all prior responses and tool/step bodies, producing repeated large observations or quadratic storage. | One retained observation set and bounded phase-specific views/headers/references. Replace report snapshots, do not accumulate full copies. Reuse existing acknowledged evidence and explicit capacity recovery; no second journal or storage interface. |
| D06 / P2 | Omit<AgentConfig,...> rejects fresh excess-property literals but can allow forbidden keys through structurally typed variables. Async factories also need admission reservations. | Add never-valued forbidden name/parent/toolManager keys, discriminated parent/worker requests and runtime preflight. Reserve worker name/capacity before awaiting config; reject late orphan installation and release reservations once. No trial Agent construction or new public factory framework. |
| D07 / P2 | “One provider request per page” conflicted with C4 safe-read/auth retries. Broad capacity audit could become a rewrite of every bound. | One logical page fetch, observed physical retries, no automatic next-page traversal. Keep whole-page/source guarantees. Inventory capacities, fix validated selected-path loss; do not rewrite unrelated protective bounds or add a cursor database. |
| D08 / P2 | C8's shared-backend profiles could imply an unapproved production backend prerequisite or support proven by a skipped suite. | Required conformance covers current in-memory and file backends, including actual child-process file recovery. Shared-backend claims remain optional until a concrete adapter is selected and exercised. No eager production test-runner dependency. |
| D09 / P2 | C6 contract copies could drift; C9 could grow a parallel model/rule catalog, Cartesian compatibility matrix or presentation override framework. | Plan owns stages/gates; API owns core contracts/ownership; follow-up owns C9 evidence/constraints. Sparse verified capabilities project existing facts. Reuse private parameter assessment for selected normalization and frozen legacy validation. Vendor catalog is pure data; host composes overrides. No generic rules DSL, runtime research service or theme engine. |

These resolve **design** findings. They do not fix current runtime gaps or prove
new APIs work. Historical revision-2/3/4 findings/evidence retain their original
meaning; revision 5 supersedes their proposals where explicitly stated.

## Source checks and executable controls

- [BaseAgent](../../src/core/BaseAgent.ts) already forwards DirectCallOptions.signal.
  Its identity-tool builder calls the legacy factory and only applies toolFilter
  when the filter has entries. Ordinary registration does not imply connector source.
- [ToolManager](../../src/core/ToolManager.ts) already provides registerConnectorTools
  and invocation-owned metadata. Reuse that path for admission/identity filtering.
- [ToolCatalogPluginNextGen](../../src/core/context-nextgen/plugins/ToolCatalogPluginNextGen.ts)
  caches discovered connector categories and loads them through
  [ToolCatalogRegistry](../../src/core/ToolCatalogRegistry.ts), whose resolver calls
  the legacy factory. A static identity filter is not a catalog profile contract.
- [BaseAgent context initialization](../../src/core/BaseAgent.ts) spreads context
  config over top-level identity/storage/timeout defaults. Preserve that legacy
  behavior; C6's new path must reject conflicting authority copies explicitly.
- [SharedWorkspace](../../src/core/context-nextgen/plugins/SharedWorkspacePluginNextGen.ts)
  is intentionally one board shared across contexts. Keep its existing ownership
  model rather than inventing private workspace semantics.
- [Agent](../../src/core/Agent.ts) already has managed execution ownership. Reuse it
  behind the selected composition guard; do not implement another global scheduler.
- [Strict type prototype](../evaluations/consumer-api-design/contracts.ts) includes
  positive direct-signal/static-registration controls and 14 negative controls.
  A non-literal forbidden-key return and missing worker type are rejected. These
  are ambient proposed declarations, not implemented exports.
- [Five offline review probes](../evaluations/consumer-final-simplicity-probes.mjs)
  reproduce direct signal forwarding, legacy tool coexistence, the working static
  recipe, catalog alias reload and context identity precedence using current public
  APIs. The custom tool is a stand-in to characterize registration, not an enhanced
  factory implementation. Network is blocked; no live writes occur.

## Final delivery boundaries

| Slice | Minimum result to approve for implementation |
| --- | --- |
| C1 | Invocation-owned failure provenance over the existing pipeline, old raw returns/callbacks unchanged. |
| C2/C3 | Private binding foundation, then one verified facade with task/final checks, safe same-process admission and no settled effect replay. One public release boundary. |
| C4 | Fixed audited execution profile, accurate effects/cancellation/projections and proven explicit static registration. |
| C5 | Whole logical pages, honest continuation/coverage, exact source and tested manager-local catalog integration. No cursor database or hidden restart promise. |
| C6 | Complete host configuration before construction, one ownership/precedence contract, authorized board membership, per-operation accounting and child lifetime. |
| C7 | Separate negotiated outcome/evidence representation through the existing executor; literal protocol v2 untouched. Wire schema still needs stage-entry review. |
| C8 | Reusable current-backend conformance and composed verified completion/source/cancellation/compatibility evidence. No new production backend. |
| C9-A | Independent sparse endpoint-specific capability companion; unknown remains unknown, exact provider support required for each claimed entry. |
| C9-B | Independent public effective-request assessment and opt-in neutral temperature normalization; strict old defaults remain. |
| C9-C | Independent browser-safe vendor presentation data; IDs/auth/custom-service ownership remain. |

Keep the recommended core sequence **C1 → C2/C3 → C4 → C5 → C6 → C7 → C8**.
Actual dependencies still allow C6/C7 selection independently; C8 tests grow from
C1. C9 subtracks are independent and do not block core delivery. Select one slice
at a time. Every selected slice needs extensive meaningful legacy/new-path tests,
runnable examples, relevant AMOS coverage and Version 2/public-documentation handoff.

C5's manager-local catalog adapter, C7's wire bytes and C9's exact signatures are
explicit stage-entry API gates, not implicitly approved designs. They must fit the
frozen contracts; no breaking change is an implementation option. An unresolved
required gate blocks that slice's completion, not silently becomes a limitation
inside a “done” report.

Durable routine resume C3-R, durable cursor codecs, production backend/retention,
distributed budgets/exactly-once delivery, Stage 14B/16B, consumer upgrades and
package release remain deferred. No default flip, automatic migration or new
global capability/factory/inspection registry is included.

## Fresh validation and approval

All **500 existing tests across 16 files pass**, with zero failed/skipped tests.
The legacy built-package TypeScript consumer, **202 public ESM/CJS controls** and
the strict API prototype with **14 negative controls** pass. Fresh characterization
runs match the original 17 observations, the seven registry observations and five
new review observations: **29 total**, describing current gaps and intentional
compatibility behavior. None is presented as an implemented fix.

The machine record records exact commands, reports, local links/whitespace,
document/prototype hashes and unchanged runtime evidence. No source/app/dependency
changes, real model/service calls, external writes or full-unit/live rerun occurred.
Proposed behavior still needs implementation tests. Prior Stage 14A full/live
results and revision-2/3/4 review totals remain historical.

**Approval requested:** revision 5's stage boundaries, additive API direction,
compatibility/acceptance gates and exclusions. This is approval of the plan;
implementation starts only after the user selects a slice. C1 remains the recommended
first core slice. No old agent is required to migrate.
