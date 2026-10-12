# Stage 00/01 second review

Reviewed: 2026-10-08. Scope: the uncommitted Stage 00/01 implementation and the
first corrective pass on branch `version2`, relative to `43b34cd`.

This is a review record and proposed fix plan. No production code was changed
during this pass. The first pass's
[review and completed fixes](STAGE_00_01_REVIEW_AND_FIX_PLAN.md) and
[validation results](../evaluations/STAGE_01_CORRECTIONS_VALIDATION.json) remain
historical evidence; the findings below identify additional cases those checks
did not cover.

## Findings

### S1 — P1: a later spill can overwrite previously compacted evidence

Location: `src/core/context-nextgen/strategies/AlgorithmicCompactionStrategy.ts`,
lines 184–195 and 326–331.

The collision allocator considers only the current tool-pair inventory. It does
not consider keys already in working memory. The ordinary key retains only the
last eight characters of a call ID and omits the protocol namespace. After an
earlier group leaves history, a later result with the same generated key replaces
its stored value. Checking that the key is retrievable then succeeds for the new
value, and the new history group is removed too. The old evidence is lost.

**Reproductions:**

- Spill a large native function result for `lookup`, call ID `first-12345678`,
  with marker `FIRST_SOURCE`. Then spill a separate result for
  `second-12345678`, with marker `SECOND_SOURCE`. The only remaining memory key
  is `raw.tool_result.lookup.12345678`, containing `SECOND_SOURCE`; history is
  empty. Both full IDs are distinct and each group has a valid call/result pair.
- Repeat with context state serialized and restored into a new context between
  spills. The same overwrite occurs.
- Use function and custom namespaces with the same call ID in separate passes.
  The same overwrite occurs. The within-batch namespace collision regression
  does not exercise this case.

The short-key collision risk predates Stage 01 for message results. The first
corrective pass adds native spill support and within-batch collision handling,
but does not close the collision risk across separate passes or restored state.
This is an overwrite, not an intentional capacity eviction.

**Compatible fix:** Allocate spill keys against existing working-memory entries
as well as the current batch. Keep the ordinary key when unused; allocate a
distinct suffix when occupied by another source. Retain the existing value and
description. Verify that writes retain the intended results before removing the
group. Keep this in the existing strategy/store integration; a new evidence
framework or saved-session migration is unnecessary.

**Required coverage:** Separate passes; distinct full IDs with the same suffix;
function/custom namespace collisions; sanitized-name collisions; state
serialization/restoration; retry after a partial write failure; capacity eviction;
and unchanged ordinary keys/values for non-colliding results. Retrieve both
markers through working memory after compaction.

### S2 — P2: known request constraints arrive too late to guide compaction

Location: `src/core/Agent.ts`, lines 1512–1514 and 2563–2580; the managed streaming
and final-answer preparation paths have the same omission.

Initial preparation receives visible function definitions and instructions, but
does not receive the structured-output constraint or configured native-tool
definitions. Those contributions are added after the single allowed compaction
decision. The final validator correctly notices the larger request, but can only
reject it. Consequently, a normal request can fail even though removing old,
unprotected history would make it fit.

**Reproduction:** Use a 1,000-token host window, 100-token response reserve,
`DefaultCompactionStrategy`, evictable old user history, and a native JSON schema
known in `run()` options. Initial preparation estimates 539 tokens and invokes
no compaction. Final validation raises `CONTEXT_OVERFLOW`; the provider is called
zero times. Remove only the old history and retry with the same schema and
provider: the final estimate is 684 tokens and the call succeeds with parsed JSON.

**Compatible fix:** Include already-known structured-output and native-tool
contributions in initial preparation. Resolve the actual native/prompt/deferred
structured strategy using the selected tool definitions, and refresh its counted
contribution when compaction changes those definitions. Reuse the existing
request construction/accounting paths. Preserve one bounded compaction pass and
the final validation after hooks/listeners; do not add a retry loop or compact
again for unexpected late hook mutations.

**Required coverage:** Managed run and stream; native schema and prompt suffix;
native-tool definitions; evictable history that makes the request fit; catalog
changes that affect structured strategy selection; tool-free suspend/wrap-up
calls; genuinely oversized protected contributions rejected before dispatch;
and no additional compaction for late host mutations.

### S3 — P2: initial preparation ignores a known provider capacity

Location: `src/core/Agent.ts`, lines 2675–2687, and
`src/core/context-nextgen/AgentContextNextGen.ts`, lines 1508–1512.

The actual provider's capacity is resolved only during final dispatch validation.
Initial preparation uses the owning context's registry/fallback window. If an
ordinary custom model has a smaller provider-advertised capacity, preparation
does not compact when it should. The final guard then rejects a request that
would fit after ordinary history eviction. This needs no model-changing hook.

**Reproduction:** A custom provider advertises an 800-token input window. Create
a managed agent with an unknown model alias, no explicit host window, a
100-token response reserve, and evictable old history. Initial preparation uses
the 128,000-token fallback and invokes no compaction. Final validation raises
`CONTEXT_OVERFLOW`; provider calls remain zero. Remove only the old history and
retry: dispatch succeeds and the final diagnostic window is 800 tokens.

**Compatible fix:** Supply usable provider metadata for the initially selected
model before the bounded compaction decision. Share capacity resolution and
explicit-host-limit precedence with final validation. Preserve fallback behavior
for throwing/invalid metadata and keep the owning model and durable configuration
unchanged. Late per-call hook model changes still receive the final check without
another preparation pass.

**Required coverage:** Unknown aliases; smaller and larger advertised capacities;
explicit smaller host limits; `maxInputTokens`/`maxTokens` precedence;
throwing/invalid metadata; run and stream; and unchanged owner model/session
metadata. Test fitting-after-compaction behavior, not only final rejection.

S2 and S3 should share a small preparation contribution/capacity path. They are
listed separately because request constraints and effective capacity need
different regression coverage. Avoid two competing preparation systems.

### S4 — P2: function-result errors can bypass both budget checks

Location: `src/core/context-nextgen/AgentContextNextGen.ts`, lines 1774–1783;
provider conversion: `src/infrastructure/providers/anthropic/AnthropicConverter.ts`,
lines 759–768.

The function-result estimator counts `content` and image attachments but omits
`error`. The neighboring custom-result branch already counts its error field.
For a supported function result with empty string content and a nonempty error,
Anthropic's converter uses the error as the actual result text. Both preparation
and final validation therefore accept a request that contains far more text than
they counted.

**Reproduction:** Use the public `addToolResults()` API with a matching call,
`content: ''`, failed state, and a 17,000-character diagnostic. In a 1,000-token
window with 100 reserved tokens, preparation and final validation accept a
35-token estimate. Converting that exact request with the real Anthropic
converter preserves all 17,000 error characters, estimated at 4,858 tokens by the
same local estimator. No network request is needed to demonstrate the mismatch.

The missing estimate predates Stage 01; it is a remaining coverage gap in the
stage's final-request guard. It is distinct from ordinary tokenizer uncertainty.

**Compatible fix:** Include function-result error text under the existing
conservative accounting policy, consistent with custom results. Preserve error
payloads and provider conversion behavior. Ensure the same calculation is used
for preparation, final dispatch checks, and auxiliary checks.

**Required coverage:** Empty content plus large error; empty error; content and
error together; attached images; pending protected results; evictable historical
results; and an offline provider-converter comparison. Confirm that an oversized
protected error is rejected before provider dispatch and that fitting failures
remain visible to the model.

## Recommended fix order and scope

1. Close S1's evidence overwrite first and add regressions for subsequent spills
   and restored state.
2. Address S2 and S3 together using the already-known request contributions and
   effective capacity during initial preparation. Keep the final boundary check.
3. Close S4's missing error accounting and add the converter-based regression.
4. Run focused regressions, then the full unit suite, build, type checks, lint,
   examples, and the Stage 00 built-consumer compatibility gate. Re-run relevant
   opt-in live cases after implementation to validate fitting compaction and
   structured output across OpenAI, Anthropic, and Google.
5. Update the context preparation guide, stage execution record, Version 2 Guide,
   and affected examples/AMOS inspection evidence to reflect the actual behavior.

No breaking API change is required by this plan. Any low-level preparation
options should be additive and optional. Preserve supported existing signatures,
session loading, ordinary spill keys, direct-call behavior, hook/event contracts,
and explicit host-limit semantics. If implementation reveals a necessary break,
stop that work and request the user's explicit approval with alternatives.

Do not expand these fixes into model routing, a new retention architecture,
automatic helper retries, or another execution framework. Those are separate
roadmap stages. These findings should be resolved before treating Stage 01 as
ready for approval or moving on to Stage 02.

## Validation performed during this review

- Focused existing regressions: **7 files / 132 tests passed**, covering managed
  freshness, corrective behavior, protocol groups, algorithmic compaction,
  baseline reporting, and AMOS context inspection.
- `npm run typecheck`: passed.
- `npm run test:agentic:compat`: passed against the already-built public package.
- `git diff --check`: passed before adding this review record.
- Offline reproductions confirmed all four findings. S1 also reproduced with
  distinct full IDs and after serialized state restoration. S4 used the actual
  Anthropic converter rather than a simulated wire format.
- The full unit suite, build, examples, and live suites from the preceding
  corrective pass were not re-run during this review. No new billable calls were
  made; the new failures are deterministic storage/preparation/conversion cases.

Reproduction scripts and logs were kept in the local temporary directory, not
added as permanent regression tests or production code. The cases and measured
results above are the durable review record. Once fixes are authorized, promote
the cases into the relevant existing test suites.

## Corrective completion — 2026-10-08

The user authorized all four fixes. S1–S4 are implemented and validated in the
same `version2` working tree. The original findings and review-only validation
above are retained as the historical record, not current unresolved issues.

- **S1:** Raw working-memory entries seed allocation before new spills. Existing
  base/suffix keys and their descriptions are retained; later sources receive
  distinct namespace suffixes. The intended stored values are checked before
  history removal. Regressions exercise separate passes, full-ID/name/namespace
  collisions, save/load, preexisting suffixes, failed-write retry, and mismatched
  stored values. Existing capacity eviction and partial-write side effects remain
  documented limits; no backend transaction or session migration was introduced.
- **S2/S3:** One private managed preparation helper supplies known provider
  capacity and a synchronous contribution callback. The callback reuses existing
  structured-strategy selection after visible tools are selected, including after
  compaction. All managed preparation sites use it, with tool-free semantics for
  suspend/wrap-up. Final validation still checks later host changes and shares
  capacity precedence. Public optional `getRequestOptions`/`modelMaxContextTokens`
  options preserve old preparation calls and durable owner metadata.
- **S4:** Function-result error text uses the existing conservative estimator,
  alongside content and images, through preparation and final/auxiliary checks.
  A regression compares a fitting empty-content failure with the actual Anthropic
  converter; oversized protected errors retain their bytes and fail before dispatch.
- **Validation:** 326 files / 6,895 unit tests passed, including 32 added
  regressions; 806 focused tests passed with scoped context/AMOS coverage. Build,
  types, lint, examples, strict core/live-test compilation, public consumer
  compatibility, AMOS, and API generation passed. Sixteen context live cases and
  24 Stage 00 live workload/split scenarios passed across OpenAI, Anthropic,
  and Google. The initial full-suite sandbox attempt failed the unrelated local
  WebSocket listener test; the complete suite passed when loopback binding was
  permitted. No unavailable providers or skipped live scenarios were counted.
- **Examples/docs:** `example:context-budget` demonstrates all four corrected
  behaviors without credentials. The AMOS example/tests display selected capacity
  and schema contributions without another preparation. Current docs, Version 2
  adoption/handoff, generated API and package documentation inventory are updated.
- **Compatibility:** No breaking API change was required or implemented. Ordinary
  keys, defaults, public signatures, direct calls, legacy plugin/strategy interfaces,
  valid hook/event behavior, and format-v1 session loading remain supported.

See [the second corrective validation record](../evaluations/STAGE_01_SECOND_CORRECTIONS_VALIDATION.json)
and [Version 2 adoption record](../VERSION_2_GUIDE.md#stage-01-second-corrective-adoption-record--2026-10-08).
Stage 01's second corrective pass is complete on branch; package version remains
`1.2.0`, publication is not claimed, and Stage 02 is not implemented by this change.
