# Stage 07 — Structured summaries and observation masking

Status: complete on branch as an experimental opt-in delivery, including all
three review corrections validated 2026-10-15. See the
[corrective completion](STAGE_07_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-15)
and [evidence](../evaluations/STAGE_07_CORRECTIONS_VALIDATION.json). Earlier
implementation, pilot, review and completion records remain historical snapshots. User authorized
Stage 07 with “proceed” on 2026-10-14. Work is on `version2`, based on committed
Stage 03 revision `224e395`. No release, default change, commit or push is implied.

## Delivery decisions

Two additive strategy registrations use one bounded pre-call transaction under the
existing context-operation/revision guard. The algorithmic default, legacy custom
strategy contract and explicit between-executions rollover remain unchanged.
`CompactionContext.compactConversation` is an optional capability; legacy callers
and strategies need no new method. No task-state or typed-contribution framework
is introduced.

Both strategies require the opt-in built-in evidence plugin. Source retention uses
its existing storage, redaction, retention and acknowledgement policy. Internal
`__context_source__` records are context bookkeeping, not external tool executions;
they do not emit tool execution events. The complete source is read and compared
before helper transfer and again before apply. Storage failure, redaction that
changes the source, expiry or eviction preserves history. Stale work cannot apply;
already acknowledged orphan sources may remain for host retention maintenance.
There is no multi-store transaction or crash-resumable external action guarantee.

User messages remain verbatim. Call arguments and receipt metadata remain exact.
Only read observations with acknowledged, matched, settled evidence are masked;
write/unknown observations, pending dependencies, recent turns/items, opaque
provider state and multimodal groups stay exact. Summary capsules use assistant
text and identify themselves as untrusted data; summary text never becomes a
system/developer rule. Schemas and references validate structure/provenance, not
semantic truth. The source reference permits bounded reinspection.

Structured summaries bind the configured `compactor` through the existing named
connector/helper boundary, share the active `ModelTask`, and forward cancellation.
Cross-connector transfer still requires `allowContextTransfer`. The helper has no
tools and one local-schema repair at most. A configured transaction deadline bounds
storage/helper work. The default single masking fallback uses the same stored
source; cancellation, stale revisions and source loss never authorize apply.
The final request is rebuilt and recounted once; failure to fit is explicit.
New strategies do no post-cycle consolidation, avoiding a second summary owner.

## Research recheck — 2026-10-14

[The Complexity Trap](https://arxiv.org/abs/2508.21433) supports measuring a simple
masking baseline alongside summaries in coding agents; its reported results are
not a general savings guarantee for this library.
[ACON](https://arxiv.org/abs/2510.00615), revised June 2026, supports evaluating
compression fidelity and total overhead on long tasks before choosing a smaller
compressor. [Anthropic's context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
supports compact working context and retrieval of retained sources. This stage
adopts those design principles without introducing learned compression policies
or promising semantic preservation from a JSON schema.

## Frozen evaluation contract (before live comparison)

Use algorithmic, observation masking and structured summaries on identical long
synthetic local workflows, with the same tool environment, host instructions,
main model, explicit call ceiling and response cap. A shared read_source tool
returns bounded answer/artifact fields by evidence ID or exact scratch key.
Development initially exposed oversized unbounded scratch reads; the common bounded
reader was frozen before any held-out/live comparison, without changing the library
truncation policy or relaxing completion predicates. Freeze independently authored
development/held-out task variants and exact completion predicates in the example
fixture. Intended live combination: OpenAI `gpt-4o` main and `gpt-4o-mini` compactor,
with thinking disabled and helper output/input limits explicitly configured.
Provider-specific functional probes also cover OpenAI, Anthropic and Google.

Run at least six held-out task variants with two repetitions per strategy in
seeded shuffled order. Include corrections, exact identifiers, an unknown action
completion, an approval constraint, disjoint evidence and source reacquisition.
Record every main/helper/repair attempt and complete ModelTask usage, known model
cost, unknown cost/usage, latency, compaction savings, source reads, repeat actions,
and deterministic constraint/protocol outcomes. Synthetic tools perform no external
writes. Record failures rather than counting a later rerun as their disappearance.

Hard invariants tolerate zero known regressions. The bounded live comparison is a
functional pilot, not statistically powered non-inferiority evidence; summarize
paired completion counts and uncertainty at the task level, and make no general
quality, cost-reduction or cheapest-model recommendation. Strategies ship opt-in
and experimental under roadmap section 6.3. Algorithmic remains the default and
rollback baseline. Promotion requires a separately designed, adequately powered
comparison; this stage does not claim that promotion.

## Required delivery gates

Regression/failure/lifecycle/compatibility tests, mock cross-subsystem integration,
source and built public ESM/CJS consumers, cancellation and race coverage, actual
file persistence, examples and AMOS strategy selection/inspection. Root build,
types/lint/units, strict new-test types, baseline consumer, examples types, AMOS
build/types, all existing stage offline/live gates and the new bounded comparison.
Generate API docs and verify package/link inventory. Keep prior stage records
immutable. Update the Version 2 availability/adoption/handoff and standard guides.
Actual results and limitations will be appended after validation.

Initial live provider probes: Anthropic passed; OpenAI returned a source reference
ID rather than the exact observed marker; Google rejected the native JSON schema
as too many serving states. Provider probes now require an exact source read
before answering (unchanged exact completion predicate). Provider schemas omit
large text/section length bounds, while the full 12-entry/600-character/reference
bounds remain enforced locally before applying any summary. Generic compactor
instructions distinguish citations from observed values. These development failures
remain part of validation evidence; the held-out comparison predicates are unchanged.

The second probe batch passed OpenAI/Anthropic; Google passed schema admission but
failed helper completion. Its recorded 1010 output tokens included 979 reasoning
tokens, leaving only 31 visible tokens under the 1024 cap. The unified disabled
thinking request did not suppress provider-default helper reasoning. The Google
functional probe now reserves 4096 helper/capsule tokens and explicitly disables
main-call reasoning through supported vendor options. This is fixture capacity
configuration, not a provider API/default change; inclusive usage remains recorded.

The unchanged 4096-token Google capture run subsequently passed with a complete
summary (429 visible output tokens plus 602 reasoning tokens). Earlier failed
answers were not captured; their recorded near-cap usage and output-validation
failures remain evidence, not an exact account of their unseen text. Final automatic
helper schema limits sections to two entries and explicitly requests short,
nonduplicated facts; the full local safety bounds remain enforced before apply.
This bounded policy is validated by the complete live gate, without claiming that
stochastic provider behavior is eliminated. Captured responses classify request
shape only; ModelTask owns purpose/repair attribution.

The first complete live batch passed all 66 older cases and three provider probes,
but 23/36 comparison runs failed exactAnswer; account/status/no-write/no-repeat
checks passed. A fresh development trace captured a successful exact source read
followed by added prose in answer. The original task prompt did not explicitly
specify the evaluator's verbatim field-copy contract. The harness now records
actual parsed answers, returned source fields, main responses/tool arguments and
tool outcomes. Main instructions/schema descriptions explicitly require copying
the source answer verbatim; completion predicates remain unchanged. The consumed
six-case pilot is retained as diagnostic-v1, and six new separately specified
variants are frozen as held-out v2 before the next comparison. They share the
same lookup scaffold; neither pilot supports broad quality inference. Runtime
strategies and helper policy are unchanged by this experiment-contract correction.

Diagnostic artifact limitation: the fixed-path development diagnostic writer
reused its JSON filename during the clarified-contract rerun. The original full
usage report was overwritten before a distinct v2 filename was created; exact
answer/source-read observations were recovered from the earlier tool output and
are explicitly labelled excerpts. The original complete 105-case/23-failure live
batch and all probe batches are preserved. Fresh held-out v2 has its own
pre-dispatch freeze and distinct report paths.

The fresh v2 batch passed 33/39 cases. Five comparisons had provider/deadline
failures; three recorded 10–17 minute durations under 120-second deadlines,
consistent with process suspension or a clock jump, but the earlier reports did
not retain exact provider messages. One algorithmic baseline invented an invalid
evidence ID and then followed failure-receipt IDs instead of its notes key; scoped
reads rejected them, with no action replay. All outcomes/unknown charges remain
recorded. A complete unchanged v2 rerun is used for the final functional gate;
only error diagnostics and TypeScript trace annotations change, not prompts,
workloads, settings or assertions. Both batches remain evidence; no reliability
or statistical promotion is inferred from a successful rerun.

The unchanged v2 rerun passed 38/39 cases: both new strategies passed 24/24;
cache-revocation/algorithmic invented a symbolic evidenceId and returned its
validation error as the answer. The common example reader now documents selector
semantics in its argument schema, constrains UUID syntax, and gives actionable
recovery errors for missing/receipt-only sources. These are example/tool-affordance
changes applied uniformly, not an algorithmic/default change or relaxed predicate.
The consumed v2 cases are retained as diagnostic-v2; a fresh v3 split is frozen
before comparison. A local review also added full tenant/namespace admission guards
and AMOS helper-cap forwarding/config roundtrip regressions. AMOS's capsule allowance
is at least 1024 and honors a larger configured compactor output cap; the helper's
own tighter cap remains enforced.

## Completion — 2026-10-15

Stage 07 is complete in the `version2` working tree based on Stage 03 commit
`224e395`. No commit, push, package release, default promotion or breaking API
approval is claimed. The generic strategy mechanisms are available; the bounded
pilot is not a statistically powered adoption or cheapest-model recommendation.

Delivered two additive registry entries and public constructors/configuration
and diagnostic types. Both retain scoped acknowledged source snapshots before
replacement, keep exact user/action metadata and protected dependencies, and
operate in one revision-guarded pre-call transaction. Full owner/tenant/namespace
and strategy admission are rechecked before applying. Sources are verified before
helper transfer and commit; redacted mismatches, lost sources and stale work keep
protected data. Canonical JSON handles ordinary undefined metadata without changing
live returns/events or saved-session schema. Native output-only/opaque/multimodal,
write/unknown and pending groups stay exact, and can cause explicit overflow.

Structured helpers use the existing named compactor, active ModelTask, bounded
schema repair and one masking fallback. Generated notes prioritize observed facts
and exact identifiers, follow the historical material they summarize, and defer
to current user/host instructions. They remain assistant data, not authority or
proof of semantic truth. New strategies do no post-cycle consolidation; explicit
rollover/custom strategy contracts and the algorithmic default are preserved.

AMOS supports persisted selection, last-preparation diagnostics, task usage routing,
configured helper output headroom, old config loading, actual config roundtrip
and rollback on failed settings save. Selection preserves the active agent/session
and makes no immediate model request. The real-runner offline walkthrough shows
actual masking and one original read with temporary file evidence/settings.

Final validation:

- **7,594 units / 349 files**, including **121 Stage 07 cases** (98 context strategy,
  13 agent integration, 10 AMOS), with zero failures/skips.
- **105 live cases / 117 distinct scenarios**: 66 existing cases from the retained
  full baseline batch plus the final fresh 39-case Stage 07 gate, with zero final
  failures/skips. New cases include 36 paired/shuffled task-strategy runs and three
  actual OpenAI/Anthropic/Google helper/read probes. All final task predicates pass.
- **17 offline examples**, plus 18 final held-out scripted cases. Built public
  ESM and CJS execute the same comparison body successfully.
- Root build (24 public export files), source/lint, strict test/example types,
  public consumer compatibility, AMOS types/build, regenerated API (1,671 items),
  package inventory and documentation/artifact checks pass.
- Three strategy modules: **97.22% lines / 88.70% branches / 100% functions**.
  These percentages exclude Agent/context and AMOS; their integration is tested.

The final pilot records 12/12 completions per strategy. Algorithmic and masking
use 24 actual model attempts / 12 source reads each; summaries use 36 attempts /
12 reads including compaction. Estimated model costs are $0.14256 / $0.14948 /
$0.16116 and observed median wall times are 2.20 / 2.46 / 5.99 seconds respectively.
Summaries add cost/latency here with no final completion-count improvement. These
comparison-only figures exclude prior failed batches, provider probes and external
fees; registry prices and uncontrolled caching limit interpretation. Actual usage, returned models, known/unknown model
cost, latency, source reads, parsed answers, tool outcomes and dispatched synthetic
contexts are retained. Six separately specified variants share one lookup scaffold;
no representative-task, non-inferiority, reliability-rate or general savings claim
is made. Algorithmic remains the default and rollback reference.

Earlier failed batches remain explicit: source fixture/setup/type errors, three
old registry-count assumptions, Google native-schema and output-headroom failures,
the under-specified first answer contract, suspended/late transport cases, invalid
source selection and historical-progress distraction. Fresh splits were frozen
after each diagnostic contract/policy change; the original predicates were not
weakened, and no library retry or output cleanup was added. A fixed-path development
report was overwritten; its original answer/source observations are recovered
excerpts rather than a reconstructed usage report. Uncaptured failed Google text
is not inferred from later answers. A later fresh all-green pilot does not erase
those observations or establish provider reliability.

[Validation](../evaluations/STAGE_07_VALIDATION.json) and
[comparison evidence](../evaluations/STAGE_07_LIVE_COMPARISON.json) retain actual
results, earlier attempts, commands, fingerprints, uncertainty and package checks.
The [recipe](../CONTEXT_STRATEGIES.md), standard guides, agent instructions,
Version 2 adoption/handoff, examples/index, AMOS and Changelog are synchronized.
**Stage 04 — task state and protected host constraints** is next in the core
sequence and remains separately authorized.

## Corrective completion — 2026-10-15

All three review findings are fixed and validated in the `version2` working tree,
based on `224e395`. Stage 07 completion is restored as an experimental opt-in
delivery. No commit, push, release, default promotion or Stage 04 implementation
is claimed. The earlier review and validation JSON remain immutable snapshots.

- **R1:** Only groups that the selected policy can change enter source allocation.
  Standalone exact user messages and, for masking, unchanged assistant narration
  remain in history without consuming the archive budget. Complete connected
  groups still retain their exact user/action metadata. Oversized and protected
  groups stay exact; the default source cap remains 8,192 tokens.
- **R2:** An optimistic bound includes the reference envelope, minimum valid
  summary capsule, observation threshold and minimum savings. Known no-ops return
  before source writes or helper requests. A summary that cannot meet its bounds
  can use permitted masking without requesting the helper. Final checks still
  use the actual acknowledged reference/output: uncertain rejected proposals can
  leave orphan sources under the existing retention policy. No new cache,
  scheduler, cleanup service or default behavior is introduced.
- **R3:** AMOS restores the optional strategy field's exact previous presence/value
  on the authoritative configuration and its shared pre-update view, alongside
  runtime selection. Undefined still means no update in ordinary partial merges.
  A failed runtime rollback is reported as incomplete while configuration recovery
  is still attempted. No agent/session recreation or model call is needed.

Validation passes with zero final failures or skips:

- **7,631 units / 350 files**, including **158 Stage 07 cases**. The **37 new
  regressions** comprise 27 context/preflight cases, two real run/stream shared
  call-budget cases and eight AMOS configuration/lifecycle cases.
- **105 live cases / 117 distinct scenarios in one all-green batch**, covering the
  existing baseline plus all 39 Stage 07 cases and OpenAI/Anthropic/Google probes.
  The reused six synthetic task variants are regression fixtures, not newly
  held-out tasks or independent quality evidence. No completion predicate,
  provider selection, library retry or output cleanup was changed for this gate.
- **17 offline examples**, 18 retained scripted comparison cases, public CJS
  execution of the comparison body, and 16 source/public ESM/CJS/AMOS correction
  observations and controls. The comparison example demonstrates repeated fitting
  critical preparation with full storage and zero writes/helpers. The AMOS example
  now uses actual ConfigManager save/reload for failed-selection recovery.
- Root build/24 export files, types/lint, strict source/app test types, examples,
  public consumer compatibility, AMOS types/build and regenerated API/1,671 items
  pass. Package inventory, links, fingerprints, historical-evidence integrity,
  credential scan and diff checks are recorded in the corrective evidence.
- Three new strategy modules: **97.59% lines / 92.01% branches / 100% functions**
  (249 lines, 213 branches, 25 functions). Agent/context/AMOS integration is tested
  separately and excluded from those percentages.

All 12 cases per strategy complete. Actual model attempts remain 24/24/36 and
source reads 12 each. Estimated comparison model costs are $0.14400 / $0.14954 /
$0.15373 for algorithmic/masking/summaries respectively. This includes helpers;
prior pilots, provider probes and external fees are outside those comparison-only
subtotals. Registry prices and uncontrolled caching prevent general cost claims.
Summaries still add overhead with the same final completion count. Algorithmic
remains the default; alternatives remain experimental and opt-in.

The original failing regressions are retained: 13/25 new core cases and five
app/agent cases reproduced the defects before fixes. A historical archive assertion
was narrowed to affected groups while preserving its exact-user/action checks.
One added boundary fixture initially had no eligible older group and was corrected
by adding the missing original user turn. A focused run overlapped a build and is
not the authoritative public/app gate; the completed-build focused run passes
158/158. Earlier failed pilots and review reproductions remain available.

[Corrective evidence](../evaluations/STAGE_07_CORRECTIONS_VALIDATION.json) records
commands, results, actual model usage, public reproductions and artifact checks.
[Corrective AMOS walkthrough](../evaluations/STAGE_07_CORRECTIONS_AMOS_OFFLINE.txt)
retains the actual output. Public signatures, constructor defaults, custom strategy
and rollover contracts, session formats, raw tool/events and connector authority
remain unchanged. **Stage 04 — task state and protected host constraints** remains
next and separately authorized.
