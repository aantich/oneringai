# Consumer C1 — invocation-owned failure reporting

- Date: 2026-10-23; branch `version2`, base
  `dff238759c41431bd24712d3b045dd38fc800b37`.
- Authorization: after revision 5's review and recommendation to start C1, the
  user said **“proceed with full implementation.”** C1 is the selected first slice
  under the standing staged-development rule. No C2–C9 runtime work, consumer app
  upgrade, breaking change, commit/push or package release is included.
- Status: **complete on branch**, unpublished; all required C1 gates pass.
- Contract: [approved direction](CONSUMER_COMPATIBLE_APIS.md#2-invocation-owned-failure-reporting),
  [usage recipe](../OUTCOME_AWARE_TOOLS.md). Exact final gates and artifact hashes
  are recorded in [C1 validation](../evaluations/CONSUMER_C1_VALIDATION_2026_10_23.json).

## Delivered scope

`createOutcomeTool<TArgs, TResult>(options)` returns an ordinary ToolFunction.
`OutcomeToolOptions` replaces only its input callback with `(args, invocation)`;
`OutcomeInvocation` contains optional existing context and `reportFailure(Error)`.
These new APIs/types are exported from the root package, following the canonical
public-import convention. Existing ToolFunction/ToolContext types are unchanged.
The separate legacy `/types` declarations are not redesigned or extended by C1.

Managed pipeline admissions capture the selected callback before waits, keep
first-reported provenance separate from raw results, and retire the reporter at
callback settlement. The reporter releases its pipeline binding when it becomes
inert. First error text is captured; later throw/normalization causes remain private
pipeline diagnostics. Reported errors are operational failures, without claiming
permission denial or timeout prevention. Direct execute preserves raw behavior
without a framework outcome. No payload-field inference, ambient execution scope,
second tool pipeline, default retry or automatic effect replay is introduced.

The versioned private function bridge preserves callbacks across ESM/CJS and
duplicate bundles. Library account wrappers explicitly preserve the bridge and
existing account precedence/receiver. Legacy callbacks retain their receiver and
optional context behavior. Arbitrary decorators replacing execute are outside the
certified bridge; ordinary object copies retaining execute work. JSON/session load
does not restore executable reporting authority.

Run/stream, async accounting, evidence and AMOS consume the existing outcome path.
Caller cancellation/timeout stays primary; a late report belongs to the original
call's late diagnostics and never counts twice or enters another turn. Optional
evidence stores raw allowed observations with the reported status; storage failure
never repeats an action. Existing breaker policy still follows promise settlement.

Legacy remote protocol v2 maps a failed local server result to its existing generic
tool_failed response. It carries no new outcome/evidence fields. Its legacy
business-result classifier is unchanged; rich authenticated remote parity is C7.
Bundled connector helpers remain legacy; C4 will select enhanced implementations.

## Tests, examples and AMOS

- 33 new focused outcome-tool cases cover frozen/primitive/shared returns, business
  declines, malformed JS reports, normalization/throw/recovery, denied admission,
  concurrency, callback snapshots, cancellation/timeouts/late/stale reports,
  account wrappers, observers and evidence storage/failure without replay.
- Five new Agent run/stream/background cases exercise raw events/history, metrics,
  shared-manager identity and one-time async failure settlement. One new AMOS test
  uses actual manager results with identical business/operational payloads.
- Built-package consumer checks exercise the real root API; negative cases reject
  non-Error reports, altered ToolContext and mismatched helper result types.
- 180 new public-runtime assertions cover all four ESM/CJS/duplicate helper/manager
  combinations, cross-bundle account wrappers and unchanged literal-v2 error shape.
  Existing 202 public controls and Stage 00 baselines remain required.
- Six live cases run both managed modes on OpenAI, Anthropic and Google, forcing
  two synthetic local tools and checking identical raw results, failed/succeeded
  semantic outcomes, exact call counts and existing Agent metrics. Missing requested
  provider credentials fail. No real external action is exercised.
- `npm run example:outcome-aware-tools` is deterministic/offline, needs no keys,
  and destroys its manager. `npm run example:amos-outcome-tools` uses AMOS's existing
  renderer. Existing presentation already supports these statuses; no new app
  command/configuration or session migration is necessary.

## Validation and resolved incidents

Final validation passes **8,814 unit tests / 386 files** and **230 live tests /
14 files** on OpenAI, Anthropic and Google, with zero failed or skipped cases.
The live count includes six new C1 run/stream cases; the complete final run is
authoritative rather than a combination of partial passes. All existing pilot
quality/cost assertions remain intact. **382 public runtime assertions** pass
(180 new, 202 existing), plus built-package consumers, the strict proposal with
14 negative controls and the C1 consumer with three negative controls.

Build/24 export checks, root typecheck/lint, example types, AMOS types/build,
**41 offline example modes**, 29 matched legacy characterization observations,
generated API docs, local documentation links/anchors, whitespace checks and the
**269-file package dry-run inventory** pass. The package includes the new recipe,
example and validation record; no secret files or publication are included.
Prior Stage 14A and planning-review counts remain historical, not fresh C1 evidence.

Validation caught and resolved:

1. Selected throwing mode originally exposed the later exception text instead of
   first reported provenance. The new path now preserves the primary message and
   the original thrown error; legacy throwing mode stays unchanged.
2. The initial remote fixture assumed result-only success despite a server-observed
   failed tool state. It now asserts the real existing v2 generic failure envelope,
   with no new fields. No legacy classifier was changed to satisfy the fixture.
3. An exploratory new `/types` export exposed the existing nominal split between
   root and `/types` Connector declarations. The approved C1 root-only surface is
   used instead of publishing another incompatible type route or changing old
   subpath declarations. No casts or legacy fixture relaxation hide that issue.
4. Sandbox IPC/loopback restrictions blocked the normal tsx build and four existing
   HTTP/WebSocket tests. The required build/full suite ran with appropriate access;
   all 8,814 tests passed. They are not documented as remaining failures.
5. The first live matrix passed 228/230: the new Google fixture invited two calls
   despite selecting one function. The fixture now exposes only the selected tool
   per phase and explicitly requests one call, retaining exact three-model-call,
   two-execution and raw-result/status assertions. Both modes pass.
6. The next matrix passed 229/230: an existing Google extractor used 241 of its
   256 output tokens for reasoning, leaving invalid JSON. Helper profiles are
   independent of the main agent. The fixture now explicitly disables helper
   thinking and sets temperature zero; the unchanged output cap/schema/answer
   gates pass with zero reasoning tokens. No runtime defaults were changed.
   After both fixture fixes, the complete 230-test matrix passes without skips.
7. Package inspection initially omitted the new recipe/example because the
   package uses an explicit files allowlist. Those files and delivery evidence
   are now included; the final dry run passes. No package was published.

Generated tool implementation hashes are regenerated by the normal generator
because core source changed; registry tool names/schemas/counts are not changed by
hand. Existing portable implementation-integrity checks remain authoritative;
C1 does not bypass immutable SDK/package revision requirements.

## Documentation and next slice

README, User Guide, the tool-outcome recipe, this new recipe, regenerated API
reference, examples/index, AMOS guide, changelog, roadmap, agent instructions and
Version 2 availability/adoption/handoff are updated with actual scope and gates.
Unpublished branch availability is separate from a verified release.

The next recommended core slice is **C2**, private composite task/cancellation
plumbing, followed by C3's complete verified facade. C2 must not publish a partial
routine API or alter legacy defaults. No later slice starts in this delivery.
