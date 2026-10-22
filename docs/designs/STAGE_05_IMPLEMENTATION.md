# Stage 05 — Selective context and cache-aware layout

Status: **all review corrections complete and validated on `version2`, base
`539bbd1` (2026-10-22)**. See the [latest completion](STAGE_05_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-22),
[validation](../evaluations/STAGE_05_SECOND_CORRECTIONS_VALIDATION.json) and
[transcripts](../evaluations/STAGE_05_SECOND_CORRECTIONS_OFFLINE.txt). Earlier records
are historical. No release or breaking API change.
Authorized by the user's “proceed” following the Stage 05 scope. No breaking change,
release, main-model routing, episodic index or other conditional stage is authorized.

## Need and selected design

The existing plugin surface emits one opaque content string. A whiteboard fixture
contains a small critical receipt and a large low-priority background entry. A
bounded no-deletion compactor cannot fit that view, while selecting entries fits
without deleting or modifying the stored entries. A third-party source similarly
needs a projection and a dependency on the exact receipt. These fixtures precede
promotion; measured estimates are recorded with the offline example output.

Use explicit companion `ContextContributor` registration by an existing plugin
name, rather than optional structural method detection. Legacy plugin interfaces,
observation hooks, default layout and saved state remain unchanged. New data blocks
have IDs, priority, protected retention, dependencies, expiry and an optional
host-supplied projection. The manager selects bounded data and emits a detached
manifest; projection is deterministic, not an unrequested LLM call. Reserved evidence,
task-state and persistent-instruction plugins cannot be replaced by a contributor.

Contributors are awaited with cancellation and a cumulative contributor deadline across preparation rebuilds; legacy hook and compaction time is excluded.
GetRevision must track content, permissions and task-dependent selection changes.
Recheck revisions, selected input and scope before dispatch and after budget observers.
Late results cannot enter the request; private callback side effects remain host-owned.
Protected closures fit the configured component/source limits or fail explicitly;
ordinary history still uses the existing one-pass compaction and protocol grouping.
No history/source content is deleted merely to select a prompt view.

Contributed data is a JSON user data message, never a developer instruction.
Existing plugin instructions retain their authority; an explicit host companion
may replace its usage text. The built-in whiteboard adapter clarifies that omitted
entries remain available by store_get. Model compliance against hostile data is
not a sandbox guarantee; permissions still execute through the same ToolManager.

The optional stable-prefix layout places existing instructions first, legacy
plugin data and current date/time in a later developer message, and new data in a
user message. Tools sort deterministically. Original tool definitions, signatures,
provider items and scopes remain intact; no model capability or cache hit is inferred.
Existing context.responseReserve provides output headroom; optional additional
reasoningReserveTokens reserves space without enabling thinking or changing output
parameters. Provider/host/registry capacity, schemas and native definitions are
counted through existing request estimation. Opaque/multimodal counts remain estimates.
Actual provider input/cache counters calibrate diagnostics; missing counters are null,
not zero. Fingerprints identify scoped submitted requests, not provider cache keys.
No local selected-view cache or provider-cache service is introduced.

## Delivery/validation gates

- Selection/projection, complete dependencies, cycles/missing sources, protected
  overflow, source limits, expiry, malformed/bounded input and deterministic ranking.
- Legacy structural collisions, absent options, unchanged saved state and callbacks;
  task/evidence protection, final dispatch/repair and host-listener mutation checks.
- Deadlines, cancellation/destruction, stale contributions, input/scope changes,
  persistence/restart and no late commit or hidden model/network work.
- Managed run/stream/direct boundaries, one ToolManager, provider/schema capacities,
  output/reasoning headroom, opaque/multimodal uncertainty and unknown cache counters.
- AMOS selection/cache diagnostics/configuration and actual adapter tests; offline
  public examples and opt-in OpenAI/Anthropic/Google run/stream/cache observations.
- Build alone, then full units, type/lint/examples, strict/public ESM/CJS/legacy
  consumers, AMOS build/types, offline baselines, real-provider gates, generated API
  and package inventory. Fix failures before completion, preserve historical evidence.
- Update recipe, standard guides, examples, AMOS, AGENTS, roadmap and Version 2
  availability/adoption/handoff with actual support boundaries and measured results.


## Completion record — 2026-10-20

Historical delivery; superseded for current readiness by the 2026-10-21 review above.

Stage 05 is complete on `version2`, base `539bbd1`, with no package release or
breaking API change. The selected conditional scope is explicit selectable data
companions, a built-in whiteboard adapter and optional stable-prefix layout. It
reuses existing plugin state, storage, ToolManager, compaction, provider conversion
and usage fields; it adds no retrieval index, router, sandbox or cache service.

The measured offline need fixture estimates **7,174 tokens** for an overflowing
legacy view and **1,284 tokens** for a fitting selected view, preserving both source
whiteboard entries. The selected 114-token data message includes the protected
receipt, a dependent third-party provenance block and an explicit projection.
These are local estimates for one synthetic fixture, not measured cost savings or
proof of better general task quality.

Verified public APIs/options: optional `AgentContextNextGenConfig.assembly`,
`ContextAssemblyConfig`, `ContextContributor`, `ContextContributionRequest`,
`ContextBlock`, `ContextSelectionEntry`, `ContextSelectionManifest`, explicit
`registerContextContributor`/`unregisterContextContributor`,
`createInContextMemoryContributor`, `lastPreparation.selection` and host
`recordProviderUsage`. Assembly is disabled by default. Enabled defaults are 2048
estimated data tokens, 1000ms cumulative contributor time, 128 blocks, 65536 characters
per text/projection, legacy layout and zero extra reasoning reserve. Source caps,
expiry, priority, protected full dependency closure and explicit projections are
supported. Optional host tokenEstimator reuses ITokenEstimator, checks nonnegative
safe counts and preserves method receivers; default estimation remains unchanged.

New data is JSON user data, never host authority. Reserved evidence/task-state/
persistent-instruction views cannot be replaced. Companions attach only to existing
plugins, carry scoped/revision-checked source data and observe cancellation. Missing/
expired protected dependencies, cycles, malformed/oversized blocks, stale input/
model/principal/account/roles or changed selected prefixes reject explicitly.
Deadlines count contributors across rebuilds, excluding existing legacy hooks and
compaction. Legacy observation hooks remain nonblocking. Exactly the existing
bounded compaction path remains; final dispatch and JSON repair retain all selected
protections. Formatting reuses frozen selected data without new contribution or
compaction work, preserving main diagnostics.

Stable-prefix layout retains legacy authority while moving dynamic data/date later
and sorting visible tools deterministically. Host dynamic instructions may still
change that prefix. Manifest fingerprints are scoped local diagnostics, not provider
cache keys. Actual normalized provider input/cache counters remain distinct from
local estimates, with null for unknown and zero for observed zero. Host/provider/
registry/fallback capacity is attributed honestly; opaque/multimodal estimates remain
uncertain. No automatic cache hit, provider cache policy or estimator tuning is claimed.

Existing plugin/storage/session/event/result interfaces and defaults are preserved.
No structural method discovery occurs, including existing similarly named helper
methods. Sources persist normally; callbacks, policy, selected views and diagnostics
are not restored as authority. Reattach trusted companions after restart. Trusted
host callbacks must maintain pure revisions and scoped access; the framework cannot
undo private side effects or preempt synchronous host JavaScript. Legacy/default
execution and direct/external paths retain ownership. All adaptation is opt-in.

AMOS accepts JSON contextAssembly (no callbacks/tokenizer), optionally attaches the
whiteboard adapter at initialization/resume, and shows selected/omitted/projected
IDs/reasons plus actual/unknown provider cache counters in `/context breakdown`.
Inspection does not prepare, compact or call a model. Actual runner/command tests and
three new public offline examples cover this adoption. No new workflow completion,
permission authority or default preset behavior is introduced.

Final validation passes **8,217 unit tests / 371 files**, including **74 new Stage 05
core/AMOS cases**; **166 live tests / 178 scenarios / 11 suites** with OpenAI,
Anthropic and Google, zero failures/skips/unavailable providers; **27 offline examples**,
**12 new ESM/CJS controls** plus 54 existing preset controls, root/AMOS builds,
types/lint/examples, strict core/AMOS, legacy/public consumers, generated API and
package checks. Selected new assembly/inspection coverage is recorded in the
validation artifact; it does not describe whole-Agent/context/AMOS coverage.

Development failures are retained and fixed: JSON repair needed the frozen selected
prefix after normal history commit; cumulative deadline needed to exclude old hooks/
compaction; host-capacity attribution and changed-model admission needed explicit
checks. Pre-preparation inspection is metadata/legacy estimation only and never starts new contributors. A queued history-journal teardown race is fixed by awaiting admitted IO before deleting temporary fixtures. An existing comparison reader now returns bounded scoped raw notes keys on selector errors, never answers; its explicit zero-temperature main/helper sampling is recorded and differs from older pilot conditions. An initial Anthropic cache fixture refused repetitive directive text; the
normal synthetic catalog lookup retains actual answer, output/call budget and usage
assertions, without requiring cache hits. The final full provider batch passes;
there is no automatic retry, skip or waiver or output-cap increase. AMOS example/mock type assertions
were corrected without weakening runtime tests.

Recipe, README/User Guide/generated API, AGENTS, examples/index, AMOS, release notes,
roadmap, Version 2 availability/adoption/handoff and packaged records are synchronized.
See [validation](../evaluations/STAGE_05_VALIDATION.json) and
[offline transcript](../evaluations/STAGE_05_OFFLINE.txt). No commit, push, release,
approved API break or implementation of another conditional stage was performed.
