# C9-B — shared assessment and selected temperature policy

Stage-entry API: pure browser-safe `assessModelParameters({ vendor, model,
endpoint, reasoningEffort? })`; optional `parameterPolicy: { temperature:
'strict' | 'omit-unsupported', observe? }` on Agent configuration and managed/direct
call options. `temperature` here is the normalized provider-neutral option,
including zero; “neutral” does not mean a special numeric value. Supported/unknown
values and absence are preserved. Only explicitly unsupported normalized temperature
may be omitted. Raw `vendorOptions` sampling controls retain strict rejection.

The actual OpenAI Responses generation/stream/native-count/batch paths evaluate
effective reasoning after raw/unified precedence and defaults. Routing/fallback
therefore assesses the selected request, not constructor defaults. Reuse one pure
family/registry primitive with the old validation adapter, retaining exact legacy
errors and default count behavior. Explicit policy selection makes native counting
check the generation constraints before its input-only projection; count success
still does not certify dispatch/auth/capacity. A bounded isolated observer describes
preserve/omit/reject decisions without prompts, credentials or a global journal.

The policy is trusted host configuration. Portable v2 snapshots omit it; receiving
hosts explicitly reconfigure it. Context/session DTOs remain unchanged. Raw
Responses WebSocket keeps its existing strict validator and has no normalized
provider-neutral-temperature policy surface. No Chat Completions transport is
added; pure assessment may describe that endpoint without claiming SDK dispatch.
Custom vendors/endpoints stay unknown. Helpers keep their existing contracts.

Official parameter guidance was fetched on 2026-10-28:
https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-update-api-and-model-parameters
The documented conditional family includes GPT-6.1 Terra without adding a registry
model or changing legacy model admission. All validation is offline/mocked while
live testing is paused. AMOS defaults remain unchanged; ICOS keeps its current
guard until it explicitly adopts this contract in separate consumer work.

Delivery/review: 9,172 units pass, including 58 new cases and 30 actual mocked
model/effort request pairs. The 159-case provider/validator/native review passes;
37 built root/shared ESM/CJS/browser assertions, build/types/lint/compatibility,
example compilation, offline request demonstration and generated API pass. Review
kept routed context export's existing provider-state restriction (host policy
omission is checked before execution), handled selected Terra/unregistered-family
constraints through the shared validator, and preserved native-count item ownership
restrictions rather than claiming unsupported replay. Raw WebSocket defaults and
old count behavior stay frozen. [Machine evidence](../evaluations/CONSUMER_C9B_VALIDATION_2026_10_28.json).
No live requests were made. AMOS defaults are unchanged; ICOS adoption stays pending.
