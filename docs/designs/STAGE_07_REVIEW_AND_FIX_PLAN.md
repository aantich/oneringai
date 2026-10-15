# Stage 07 review and fix plan

Reviewed 2026-10-15 on `version2`, against the uncommitted Stage 07 delivery based
on Stage 03 commit `224e395`.

**Current status: R1–R3 fixed and validated.** See the
[corrective completion](#corrective-completion--2026-10-15) and
[corrective evidence](../evaluations/STAGE_07_CORRECTIONS_VALIDATION.json).
The findings below describe the reviewed snapshot. No runtime implementation or permanent
tests were changed in this review. Documentation, status and the package's review
document inventory are updated; the earlier completion evidence is preserved as
a historical snapshot.

Fresh checks pass: **7,594 units / 349 files**, public-package compatibility,
source/example/AMOS types and lint. All delivery runtime/test/example fingerprints
match the reviewed source. The [executable evidence](../evaluations/STAGE_07_REVIEW.json)
contains the reproduction script, observations, commands and fingerprints.
Its script asserts the presence of the defects and controls; a successful script
exit does not mean the defects are fixed. Existing green tests miss these cases.

The review covered candidate selection, whole-group/source budgets, repeated
preparation, retention/redaction and source verification, summaries and fallback,
cancellation/deadlines, scope and revision races, persistence, native/opaque
protection, helper accounting, compatibility, examples, provider probes and AMOS
configuration/lifecycle. The two library findings reproduce against source and
the built public ESM and CJS exports. AMOS uses its real runner, command and
ConfigManager with a synthetic agent transport and temporary files. No credentials,
billable calls or external actions are needed. The prior live evidence remains
recorded; live calls were not rerun for this local review, which changes no runtime.

## R1 — P2: Unchangeable messages consume the masking source budget

Location: [candidate admission and source allocation](../../src/core/context-nextgen/strategies/conversation-compaction.ts#L204).

The planner admits every safe connected group in chronological order. A standalone
user message passes approval even though masking never changes its text. That
message consumes `maxSourceTokens` before a later eligible read result is considered.
The actual observation can therefore be excluded even when its complete connected
group fits the source cap and masking it would make the model request fit.

**Reproduction:** Keep both constructors' default source/recent-window settings.
An older exact user message uses 5,662 estimated tokens, followed by an acknowledged
settled read group of 5,738 tokens, then two small recent user turns. With the
default 8,192-token source cap and a 7,000-token context, the planner archives only
the unchangeable user message. It frees nothing and preparation raises overflow
(12,112 estimated tokens including reserve). Increasing only the source cap to
20,000 admits the read group, preserves the exact user message and makes preparation
fit. That larger-cap run is a diagnostic control, not the proposed fix.

**Fix:** Plan groups that can actually change under the selected policy before
allocating source capacity. Keep complete connected groups and exact user/action
metadata. For masking, unchanged standalone user/narrative messages must not crowd
out maskable observations. For summaries, prioritize actual replaceable narrative
and observations; any contextual material supplied to the helper must be bounded
without starving those candidates. Do not solve this by raising defaults, dropping
user constraints or truncating individual groups. A group that genuinely exceeds
the source cap must remain protected with explicit fit failure where necessary.

**Regressions:** Long standalone user prefix with a smaller eligible read group;
multiple read groups competing for the cap; write/unknown/pending and opaque groups;
mixed messages where user text belongs to the same connected tool group; recent
window boundaries and unchanged chronology; both new policies and public ESM/CJS.
Assert exact user/action retention and fit at the original source cap.

## R2 — P2: Known no-op compactions consume storage and request helpers

Locations: [retention before proposal](../../src/core/context-nextgen/strategies/conversation-compaction.ts#L219),
[helper request](../../src/core/context-nextgen/strategies/conversation-compaction.ts#L224)
and [late savings check](../../src/core/context-nextgen/strategies/conversation-compaction.ts#L257).

Retention and helper work happen before the planner determines whether any saving
is possible. With only an older standalone user message outside the protected
recent window, there is no eligible observation or assistant narrative to replace.
Masking cannot change anything; adding a summary can only increase the request.
Nevertheless every preparation retains another source. Structured summaries also
request a callback before falling back to unchanged masking.

**Reproduction:** A request already fits a 2,000-token context but is above its
configured 80% compaction gate. Both policies use default source/recent-window
settings. With a bundled store limited to two records, the first two preparations
succeed, retain unchanged history, report zero saving and consume both records.
Structured summaries additionally request two callbacks. The third preparation
fails with `Cannot retain compaction source`, although the request still fits and
no lossy transformation is possible. This reproduces in source, ESM and CJS.
These are controlled callbacks, not billed model calls in the reproduction;
the managed Agent binding would invoke its configured compactor at that boundary.

**Fix:** Preflight the possibility of meeting `minTokensSaved` before source writes
or helper invocation. Return a no-op when no policy-eligible content exists, or
when even an optimistic valid replacement cannot save the minimum. Preserve final
recounting, source verification and no-saving fallback for genuinely uncertain
model proposals. Failed/cancelled proposals may still leave acknowledged orphan
sources under the documented storage contract; that does not require avoidable
writes for a transformation already known to be impossible. No general cache,
deduplication subsystem or background cleanup service is needed.

**Regressions:** Repeated fitting-but-critical preparations containing only exact
user/protected/small content; both modes; full/offline stores; helper task usage and
call budgets. Assert zero new records, zero helper requests, unchanged history and
continued preparation success. Add small potential gains below the configured
minimum, plus controls where viable masking/summary work still requires a stored
source and fails safely if acknowledgement is unavailable.

## R3 — P2: Failed AMOS settings save does not restore an absent strategy field

Locations: [command rollback](../../apps/amos/src/commands/commands/ContextCommand.ts#L105),
[runner mutation](../../apps/amos/src/agent/AgentRunner.ts#L331)
and [ConfigManager undefined merge](../../apps/amos/src/config/ConfigManager.ts#L167).

The old default configuration has no `contextStrategy`. On save failure the command
calls `updateConfig({ contextStrategy: undefined })`. ConfigManager's existing merge
deliberately ignores undefined values, so the new selection remains configured.
The runner restores algorithmic in a different object after ConfigManager has
cloned the updated configuration. Runtime and settings now disagree, while the
command reports that the previous selection was restored. The current rollback
test mocks `updateConfig` and misses the actual merge behavior.

**Reproduction:** Start with the real ConfigManager's default absent field, attach
the real runner/context with evidence, and select observation masking. Force the
settings save to fail. The command returns failure and runtime is algorithmic,
but `getConfig().contextStrategy` remains `observation-masking`. A later unrelated
successful settings save persists that rejected selection; a fresh ConfigManager
loads it. The same restore-to-absence problem applies to a summary selection with
its prerequisites configured, potentially enabling helper work after reload.

**Fix:** Restore the exact previous field state, including absence, and the runtime
selection using the actual configuration owner. Account for the runner's mutable
configuration reference and ConfigManager's cloned updates. Do not globally change
the established meaning of undefined in partial configuration merges. Preserve
same-agent/session switching and the old default, and only report restored state
after restoration succeeds.

**Regressions:** Real ConfigManager plus runner/command; absent and explicit previous
values; failure followed by an unrelated save and fresh reload; masking and summaries;
successful selection, running-operation rejection and settings rollback errors.
Assert runtime/config/disk agreement and no model call from selection or rollback.

## Corrective order and acceptance

1. Add failing regressions for all three findings, keeping public-package controls
   and the real AMOS configuration boundary.
2. Separate eligibility from source allocation (R1), then reject known no-saving
   transactions before retention/helper work (R2). Reuse the current transaction,
   group dependency analysis and evidence backend; keep its scope, cancellation,
   source-matching and final-fit guards.
3. Correct AMOS restore-to-absence ownership (R3), without changing global partial
   merge behavior or recreating the active agent/session for strategy selection.
4. Extend the offline examples with meaningful candidate/no-op and failed-save
   cases where useful. Update the recipe, Version 2 adoption/handoff, roadmap,
   standard usage guidance and generated API if public documentation changes.
5. Rebuild once before public/app consumers. Rerun focused failures, full units,
   types/lint, strict tests/examples, compatibility, public ESM/CJS, AMOS checks and
   offline examples. Run the existing full opt-in three-provider baseline and
   Stage 07 live regression gate with actual keys. Preserve prior failed/passing
   pilots; do not relabel consumed tasks as fresh held-out quality evidence.
6. Record exact results, any skips/failures, compatibility, package inventory and
   artifact checks before restoring completion. These fixes need no proposed
   breaking API change. Stage 04 remains separately authorized and unstarted.

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
