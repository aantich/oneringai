# Stage 10 second review and Google summary repair — 2026-10-16

Status: both findings fixed and validated; Stage 10 complete on branch. The
recorded Google failure is remediated and verified with real-provider recovery.
No package release, commit or push.

The user requested another review and explicitly required the recorded Google
failure to be fixed. A later passing sample had not resolved its underlying gap.
This pass reviewed the loop controller, run/stream formatting and stop boundaries,
async delivery, scope/cancellation, helper validation/accounting, context summary
transaction, public consumers, examples/AMOS and documentation.

## Findings and fixes

### G1 — P2: Shape-valid empty summaries bypassed helper repair

The recorded Google response contained all seven required arrays, each empty.
The native/helper schema accepted that shape and marked output validation passed.
`validateSummary` rejected it afterward, outside the helper's existing one-repair
loop. Strict compaction consequently failed before any main dispatch/source read.
The transaction protected history, but the recovery path was missing.

The fix preserves the portable native schema and adds optional public
`HelperCallOptions.validationSchema`. Both native and additional local schemas
must pass inside the original zero-or-one repair allowance. Additional constraints
are prompt guidance, not native response-format keywords. Independent compiler
roots preserve schema IDs/references; invalid schemas fail before packet building.
The selected evidence, input/output bounds, ModelTask calls/tokens/deadline and
cancellation rules remain unchanged. This option cannot weaken the base schema.

Automatic structured compaction now rejects all-empty sections and blank/overlong
entries inside that path. Rejected generations have `outputValidation: 'failed'`;
the real repair is accounted separately and must pass before compaction applies.
Repair exhaustion retains existing `mask`/`error` behavior. Standalone custom
summary callbacks retain their existing one-call transaction/fallback contract.
No outer retry, action replay or silent fallback was added.

Two initial native-schema prototypes were rejected by OpenAI/Anthropic. Those
probe results are retained as development history. The delivered implementation
keeps their previously supported native schema and checks the stronger invariant
locally. Google, OpenAI and Anthropic normal probes pass with that implementation.

A deterministic live fault injection substitutes the exact recorded empty body
after a real Google call. Its single repair uses real Google; it then retrieves
the source and must return the exact marker/account/status without masking fallback.
This proves recovery of the recorded failure independently of getting a lucky
valid first sample. The substitution is explicitly labeled in the live report.

### S1 — P1: Completion checks omitted tool principal and connector scope

A pending completion check could verify `accountId: work`, then return true after
the tool context changed to `accountId: personal`. Owner/task/conversation checks
were unchanged, so both run and stream reported completed using old authority.
A controlled pre-fix probe reproduced this with one model call in each mode.

The check now captures user/account, connector-account selections, identities,
roles, session and connector registry authority alongside the existing view.
Rebinding while completion/progress is pending yields `state_changed`/blocked.
It does not issue a recovery/model/action call. Twelve pre-fix regressions failed
for account/accounts/identities/roles/session/registry changes in both modes;
all pass after the fix. Existing unchanged-scope and async delivery controls pass.
The guard is internal, opt-in with the policy, and not restored session authority.

## Compatibility, examples and handoff

`validationSchema` is additive/optional; omission preserves helper behavior and
native request shape. There are no required public/session/storage fields, new
event discriminants, default policies, role changes or implicit model escalation.
No breaking API change is proposed or approved.

The public purpose-model example now demonstrates a native-shape-valid empty
answer, one locally validated repair and retained source marker/task accounting.
AMOS automatically inherits structured-summary recovery and can inspect failed
validation/repair through its existing usage/strategy views. Its documentation
and actual adapter/command examples are checked; no additional command or saved
configuration is needed. The Version 2 Guide, recipes, standard/generated guides,
AGENTS, examples, release notes and package inventory track the change.

## Validation

- **7,988 units / 360 files**, zero failures/skips; **38 new regressions** (16 summary integration, 10 helper contracts, 12 principal-scope cases).
- **454 focused coverage cases**, zero failures/skips; selected helper/compaction/loop modules **97.06% lines / 90.13% branches**, not whole-Agent coverage.
- **136 live tests / 148 scenarios**, all eight suites across OpenAI, Anthropic and Google, zero failures/skips/unavailable providers. Includes actual Google recovery from the recorded fault.
- **22 offline examples**, **18 ESM/CJS runtime controls**, **18 unchanged legacy controls**, root/`types` consumers, builds/types/lint/examples, strict checks, AMOS build/types, generated API and package inventory pass.

Final declaration formatting changed generated tool source fingerprints; a
byte reconstruction proof confirms the tested executable ESM/CJS code is identical
apart from those derived strings. Fresh final units/public controls/compatibility
also pass against the rebuilt artifacts. No live failure was converted to a skip.

See [validation](../evaluations/STAGE_10_SECOND_CORRECTIONS_VALIDATION.json),
[live recovery evidence](../evaluations/STAGE_10_SECOND_CORRECTIONS_LIVE.json) and
[offline recovery/AMOS transcript](../evaluations/STAGE_10_SECOND_CORRECTIONS_OFFLINE.txt).
Earlier records remain historical; this record resolves the missing repair path.
Stage 12 and conditional Stage 11 remain separately authorized and unimplemented.
