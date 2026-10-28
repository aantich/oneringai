# C2 — private composition ownership and execution binding

Status: **complete on branch, internal-only**; no public routine facade is advertised.
The user's full sequential authorization is recorded in the
[delivery ledger](CONSUMER_DELIVERY_LEDGER.md). Existing runner/options/types remain.

The private composition lease owns one borrowed Agent, supplies the explicitly
shared ModelTask and derived signal to managed execution, and uses existing direct
and helper options. Admission is synchronous and consumed before hooks or awaits;
there is no ambient async-local execution identity or serialized authority.
Unrelated managed/direct/stream/maintenance/continuation calls fail while selected
ownership is held. Existing direct concurrency outside this opt-in stays unchanged.

Raw provider, helper and tool promises remain tracked after a caller stops waiting.
Closing requests cancellation and retains occupancy until actual settlement;
borrowed tasks are never destroyed/cancelled by a child timeout. Async deliveries
stay with the owning operation rather than starting an automatic unrelated turn.
Signal replacement preserves the original task and deadline. Rejected replacement
cannot consume the paused owner's binding. The existing routine runner now has a private request/execution binding that
threads this same lease through recursive map/fold/until, source extraction,
reflection and deterministic step cancellation. Its legacy public options and
unselected behavior stay unchanged. The C3 coordinator will add phase verification
and continuation over these mechanics, with one public facade release boundary.

Review correction: composition admission now precedes continuation/routing
preflight and managed mutable cleanup, so a foreign caller cannot inspect or alter
the paused operation before being rejected. Late noncooperative provider settlement
and one-time task accounting have explicit regression tests. The second review
replaced module-local ownership with a versioned private per-instance bridge,
preventing ESM/CJS/duplicate bundles from bypassing exclusivity. No public or
serialized field is added. Binding snapshots are frozen, and destroyed Agents
reject acquisition. A declaration-bundler inference error was fixed with explicit
private getter types.

The public offline recipe is `examples/composite-execution-binding.ts`: existing
managed/direct/helper APIs share a ModelTask with explicit supported cancellation.
It makes no live calls and cleans up Agent, task and connector. No public RunOptions
signal was added. AMOS's verified operation UI is C3; adding a temporary C2 command
would expose an incomplete API and is intentionally unnecessary.

Final gates pass **8,847 units / 387 files**, **236 live tests / 15 files** on
OpenAI, Anthropic and Google with zero failures/skips, **450 package/runtime
assertions** (382 retained plus 68 private cross-bundle checks), and **42 offline
example modes**. The focused routine/ownership suite passes 178 cases, including
33 new composition cases. Build/24 exports, types/lint, built public consumer,
example types, AMOS types and generated API pass. Exact evidence is recorded in
[C2 validation](../evaluations/CONSUMER_C2_VALIDATION_2026_10_23.json).

Review also fixed yielded-direct-stream occupancy, native compaction/count late
work, destroyed-owner release, coordinator cleanup holds and foreign-Agent
binding rejection. The final lifecycle audit also retained ownership through late
tool evidence storage after raw settlement; a suspended-storage regression proves
that release waits for that bookkeeping. One recursive iteration timeout leaves the borrowed task and
sibling uncancelled; all nested purposes remain in the same explicit task.

Live fixture failures were resolved without raising caps or relaxing oracles:
OpenAI now receives an exact marker-only instruction rather than copying long
source records; the native-route restore fixture explicitly excludes evidence
tool turns and configures the selected route independently. Sanitized diagnostics
showed extra successful generation/compaction turns, not HTTP retry failures.
The final complete matrix passes with the original eight-call and output limits.

The public ModelTask recipe and examples index, Version 2 availability/adoption,
roadmap/ledger, agent instructions, changelog and package inventory are updated.
README/User Guide need no new C2 API section; generated API confirms no new root
exports. AMOS retains its existing public configuration until C3. No release,
dependency upgrade or consumer edit is included. Proceeding directly to C3.
The internal bound-routine entry point currently requires explicit unscoped use
when requiredTools is supplied; C3 must provide shared-manager scope enforcement
before exposing its public request. This is no limitation on the legacy runner.
