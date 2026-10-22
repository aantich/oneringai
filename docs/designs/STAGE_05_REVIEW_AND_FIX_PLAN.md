# Stage 05 review and fix plan — 2026-10-21

Status: **all R1–R5 findings corrected and validated on branch**. The review below
is historical; [corrective completion](#corrective-completion--2026-10-21) records
implementation and validation. No release or breaking API change. The subsequent
[second review](STAGE_05_SECOND_REVIEW_AND_FIX_PLAN.md) found three additional issues;
all are now [corrected and validated](STAGE_05_SECOND_REVIEW_AND_FIX_PLAN.md#corrective-completion--2026-10-22).
These R1–R5 fixes remain implemented; historical review evidence is preserved.

Reviewed selective assembly and registration, dependencies/projections/budgets,
deadlines/cancellation, dispatch and repair guards, persistence/legacy contracts,
provider accounting, AMOS configuration/inspection, examples and documentation.
All 26 recorded runtime/build/test/example fingerprints match the original final
validation. Fresh checks pass **293 tests in 14 files**, the built public consumer,
and **12 ESM/CJS controls**. Ten assertion-backed offline observations establish
the five findings below; see [review evidence](../evaluations/STAGE_05_REVIEW.json).

The previous **8,217-unit / 166-live-test / 178-scenario** result remains valid for
its covered paths, but does not cover these cases. The full unit/live batches were
not rerun for this review: these failures occur in deterministic host/framework
logic before model interpretation. No credentials, real LLMs or external service
writes were used; the wrap-up fixture executes a local read.

## R1 — P1: freshness and fingerprinting omit effective account/task bindings

Location: `src/core/context-nextgen/AgentContextNextGen.ts:1027–1030`.

`assemblyAuthority()` captures identities, principal, roles and session fields but
omits the supported `ToolContext.accountId`, `connectorAccounts` and `taskId`.
Account resolution explicitly gives `accountId` and then `connectorAccounts`
precedence when connector tools select accounts; identities alone are insufficient.

Using the actual built-in whiteboard adapter, prepare under account A, then change
only `accountId` to B through `tools.setToolContext`. `validateRequestBudget`
accepts the old prepared request. The same failure occurs with per-connector
account mappings and the ToolContext task binding. Fresh preparation fingerprints
were also identical across each observed binding change. A selected view can
therefore pass admission under a different effective account/task scope. This is
a host-switch/admission failure; no unauthorized remote action was attempted.

Fix: include effective supported account/task bindings in the internal authority
capture and use the same capture consistently during collection, dispatch and
fingerprinting. Audit supported registry/scope identity changes as well, without
serializing credentials or mutable registry internals. Keep contributor revisions
as an additional source-specific requirement. Preserve ordinary ToolContext APIs,
unconfigured behavior, session shapes and host-owned authorization.

Regressions: accountId, connectorAccounts and taskId changes during awaited
contribution, between prepare/dispatch, inside hooks and synchronous budget
observers; run/stream/repair; unchanged bindings and fresh preparation controls;
scope-sensitive fingerprints with dynamic prompt fields controlled. Cover a real
connector binding resolution using local tools. Do not substitute identities for
the documented precedence rules.

## R2 — P2: the submitted question can change without refreshing its selection

Location: `src/core/context-nextgen/AgentContextNextGen.ts:1657–1662`.

The normal guard compares the live context stamp with its earlier value and checks
only the submitted prefix. It does not compare the submitted history/current input
with the input used by contributors. A supported `before:llm` hook changes the
submitted question from QUESTION_A to QUESTION_B while leaving the live context
and selected prefix untouched. Both managed run and stream dispatch one request
containing QUESTION_B with SOURCE_A, selected specifically for QUESTION_A.
The contributor revision tracks the live current input correctly; that live input
was not changed by editing the detached request. Recounting the altered request
and updating its fingerprint does not repair the mismatched selection.

Fix: reconcile selection with the actual submitted task/input at the managed
boundary. Preserve supported host hook edits, default hook behavior and the one
bounded compaction contract. Establish explicit internal preparation identity for
the input selected and the input dispatched; a changed task must receive a matching
selection within its bounds or fail before dispatch. Do not silently send the old
view or add unbounded hook/contribution/compaction retries. Do not globally ban
existing hook modifications as a shortcut; if a supported extension contract truly
must be narrowed, stop and obtain explicit approval first.

Regressions: in-place and returned input edits, appended/removed/replaced user
messages and history, run/stream, synchronous request listeners, unchanged-input
controls, task-dependent contributors, bounded recollection/deadlines and fit.
An intentionally revised task must never reach the provider with the old selection.

## R3 — P2: auxiliary repair replays a superseded host prompt

Locations: `src/core/context-nextgen/AgentContextNextGen.ts:1022–1024` and
`1657–1659`.

Repair correctly needs to tolerate the main answer's normal history commit.
However, `recordPreparation:false` replaces the entire context-stamp check with
only `_originalUserInput`. That snapshot does not change when the host updates
`context.systemPrompt` or calls `context.addUserMessage`.

After the main answer commits, a normal `iteration:complete` subscriber replaces
ORIGINAL_HOST_INSTRUCTION with NEW_HOST_INSTRUCTION. Forced JSON repair still
dispatches a second request containing the old host prompt and no new prompt,
even though the live context holds the replacement. A second observation adds a
host correction at the same boundary: it remains pending while repair dispatches
without it. A queued future turn alone is not asserted to be a separate defect;
the host-prompt replacement independently establishes stale instruction replay.
Source revisions, original input, prefix and ordinary fit checks all pass.

Fix: distinguish the expected framework answer commit from actual host prompt,
task/input and policy changes. Keep internal generation/admission tracking small;
retain the frozen selected evidence for ordinary repair, with no second compaction,
no unnecessary callback reruns and no overwrite of main selection/usage diagnostics.
Do not bypass current host changes merely because the original user input matches.
Keep existing task-state checks and original errors intact.

Regressions: ordinary repair succeeds after its own history commit; host prompt
replacement, new input/corrections and host changes during budget callbacks cannot
silently reuse a stale repair frame. Cover native/prompt output, tool-assisted
formatting, existing task-state protection, revisions, cancellation and fit. Retain
pending corrections and avoid repeating tools or external effects.

## R4 — P2: selected whiteboard instructions contradict the store overview

Locations: `src/core/context-nextgen/assembly.ts:204–209` and
`src/core/context-nextgen/AgentContextNextGen.ts:1917–1927`.

The companion replaces the plugin's usage instructions but leaves the unified
store overview unchanged. An actual selected request that omits the bulk entry
contains both “Values shown DIRECTLY in your context window — no retrieval needed”
from the store schema and “Only selected entries appear as context data” from the
adapter. Both are developer instructions. The original all-visible claim is false
for the opted-in view and undermines exact retrieval of omitted values. This is a
verified prompt contradiction, not a measured claim about model error rates.

Fix: render accurate selected-store visibility/retrieval guidance in every prompt
surface, including the unified overview. Keep the native source, store tool returns,
existing public schema contract and unregistered legacy instructions unchanged.
Reuse current overview metadata rather than adding a separate store/tool pipeline.

Regressions: actual default whiteboard/store tools plus selection, omitted-entry
discovery and exact store_get recovery, both layouts, unregister/legacy restoration,
AMOS runner and direct public-package use. Assert that the submitted host prompt
contains no unconditional all-values-visible/no-retrieval claim for selected stores.

## R5 — P2: wrap-up calls leave available provider/cache usage unknown

Locations: `src/core/Agent.ts:1983`, `2081` and `2839–2845`.

Main run/stream generation records usage, but max-iteration and suspension wrap-up
paths bypass those observers. A one-iteration local-read fixture makes two calls;
the second call prepares a new selection and returns input=10, cached input=3 and
cache creation=1. In both run and stream, the latest selection diagnostic still
reports all those fields as null. The final response carries usage; the stream's
aggregate is input=20, cache read=6 and cache write=2, which must not be mistaken
for the single submitted wrap-up request's usage. The same missing observation is
present in the suspension call site, confirmed by code inspection.

Fix: observe actual wrap-up usage at each existing managed call/terminal event,
using the same helper as ordinary generation. Preserve null for absent fields and
zero for measured zero. Keep direct/helper ownership and auxiliary repair's explicit
main-diagnostic preservation contract. No new accounting abstraction is needed.

Regressions: max-iteration run/stream, suspension run, actual zero/nonzero/missing
cache fields, correct last-request estimate delta, new-preparation reset and AMOS
breakdown. Check per-request observations separately from aggregate response usage.

## Fix order and completion gate

1. Close R1 account/task admission, then R2/R3 input and repair-frame binding.
   Preserve supported hook/plugin/storage contracts and the bounded preparation loop.
2. Correct R4 prompt guidance and R5 wrap-up diagnostics, using existing stores and
   usage plumbing. Add meaningful regression and failure controls for every finding.
3. Build stable source first; then full units, root type/lint/examples, strict/public
   ESM/CJS/legacy consumers and AMOS configuration/commands/build checks. Run affected
   actual-provider assembly/structured/tool/loop suites with all three configured
   providers, plus the established stage compatibility gates. Do not waive failures.
4. Refresh runnable examples and standard/generated docs where behavior changes;
   update roadmap, Version 2 availability/adoption/handoff and package evidence.
   Preserve original validation as historical and record fresh corrective results
   before restoring completion. Any necessary breaking proposal requires approval.

The overall design remains suitably small: explicit companion registration avoids
structural API collisions, selection reuses existing sources, and cache diagnostics
avoid unsupported savings claims. These findings call for focused integration
fixes, not a router, new memory system or new workflow framework. Deliberate documented
limits (trusted synchronous callbacks, explicit size caps, no cache-hit guarantee,
legacy hook semantics and process-local callback authority) are not promoted to
additional defects. No later-stage implementation is authorized by this review.


## Corrective completion — 2026-10-21

All **R1–R5** findings are fixed and validated on `version2`, base `539bbd1`.
No breaking API change, commit, push, package release or later-stage implementation
was performed. The original review and delivery results remain historical.

- Effective accountId, connectorAccounts, taskId and opaque registry-instance identity
  join existing principal/identity/role/session guards. Credentials and registry
  internals are never serialized; same-instance custom scope changes still require
  host-scoped contributor revisions.
- Managed hook/request-listener history/input edits get one bounded selection refresh
  against the actual sanitized submitted input, sharing the preparation's remaining
  contributor time. Hooks and compaction are not repeated; concurrent mutation,
  cancellation, stale scope/revision, expiry and overflow fail before dispatch.
  Failed refresh consumes its attempt. Original source history ownership is preserved.
- JSON formatting permits the normal answer commit while checking the current host
  prompt and original history/input prefix, plus existing task/scope/source/fit guards.
  Main diagnostics stay intact; stale repair never repeats a settled tool action.
- Selected-store overview and store_get guidance describe partial visibility and exact
  recovery. Native schema objects/CRUD returns stay unchanged, including frozen
  class-backed schemas/private getters; unregister restores legacy guidance.
- Max-iteration run/stream and suspension wrap-ups record actual last-request input/
  cache counters, distinct from stream aggregates. Missing counters stay null and
  measured zero stays zero. Post-cycle consolidation performs no contributor fetches
  outside preparation ownership/deadlines.

The new dispatch-safety example demonstrates hook refresh, stale-prompt repair
rejection and synthetic wrap-up accounting. The selection example now verifies
exact omitted-source recovery and stale-account rejection: its retained-source
fixture estimates **7,174 → 1,295 tokens**, with both entries preserved. The AMOS
walkthrough forces one local read and a wrap-up, showing per-request usage and
retained whiteboard data. Usage in offline providers is explicitly synthetic.

Final validation passes **8,291 unit tests / 372 files**, including **74 new
corrective cases** (72 library and two AMOS); **184 live tests / 196 scenarios /
11 suites**, OpenAI/Anthropic/Google, zero failures/skips/unavailable providers;
**28 offline examples**; **28 Stage 05 ESM/CJS controls** and 54 retained preset
controls. Root/AMOS builds, types/lint/examples, strict/legacy/public consumers,
generated API, selected coverage and package checks pass. Coverage of assembly.ts
and the AMOS inspection adapter is 100% lines / 91.19% branches; this does not claim
whole Agent/context/store-manager/AMOS coverage.

Validation also corrected fixture setup instead of waiving failures: wrap-up tasks
explicitly include their source marker in summaries, retaining exact completion,
read and accounting assertions; the Google compactor probe explicitly requests
128 reasoning tokens and temperature zero within its unchanged 4096-token output
cap, with actual request capture and injected-empty recovery. Production thinking
and output defaults remain unchanged. The exact default/disabled prompt comparison
freezes Date, and AMOS teardown awaits admitted checkpoint/journal IO before deleting
fixtures. No sleeps, automatic test retries, cap increases or skipped providers
were added. Historical failed batches and resolutions remain in the validation record.

All adaptation uses existing connectors, sources, tools, ModelTask and usage fields.
Registry identity/input/repair bookkeeping and prompt-only schema overlays are
internal; no required plugin, public signature, saved configuration/session or
storage contract changed. Version 2 availability/adoption/handoff, the recipe,
README/User Guide/AGENTS, regenerated API, examples/index, AMOS, Changelog and
packaged evidence are synchronized. Release-wide handoff remains tracked; another
conditional stage requires separate authorization.

See [corrective validation](../evaluations/STAGE_05_CORRECTIONS_VALIDATION.json)
and [offline transcript](../evaluations/STAGE_05_CORRECTIONS_OFFLINE.txt).
