# Effective parameter assessment and temperature policy

C9-B adds pure `assessModelParameters({ vendor, model, endpoint, reasoningEffort? })`
on root and browser-safe `/shared`. It assesses actual effective reasoning, not a
model-name-only temperature flag. Named vendor is mandatory. Custom/unknown
endpoints and models remain unknown. Supported/unsupported/unknown are distinct.
Missing effort uses only documented family defaults; elsewhere it remains unknown.

The additive opt-in `parameterPolicy: { temperature: 'omit-unsupported', observe? }`
applies to Agent configuration, managed run/stream, direct calls and provider
requests. `temperature: 'strict'` explicitly selects strict assessment, including
native counting. With no policy selected, legacy generation errors/filtering and
native-count behavior remain unchanged. No API migration is required.

```typescript
const agent = Agent.create({
  connector: 'openai-main', model: 'gpt-6-sol', temperature: 0,
  thinking: { enabled: true, effort: 'high' },
  parameterPolicy: {
    temperature: 'omit-unsupported',
    observe: decision => hostDiagnostics(decision),
  },
});
await agent.run('Do the task');
```

“Provider-neutral temperature” means the normalized `temperature` option, including
zero; it does not refer to a special neutral numeric value. The policy omits that
field only when unsupported by the selected endpoint/model/effective effort.
Supported zero, other supported values, unknown values and absence are preserved.
Saved configuration is never mutated. Raw `vendorOptions.temperature`, `top_p`,
`top_logprobs` and unsupported include controls keep strict validation. The policy
is not a generic sanitizer and does not repair invalid reasoning or other options.

OpenAI Responses generation, stream, native count and batch evaluate the same
request facts after overrides, reasoning defaults and explicit conversation
`configuration_update` items. Unified enabled thinking takes precedence over raw
request reasoning; disabled thinking does not invent `none`. The latest native
configuration update determines the selected effective effort without rewriting
the cached request prefix. Actual route selection/fallback and per-call overrides
are assessed at dispatch. A single fact primitive also serves the frozen legacy
validation adapter; no second router/provider layer is created.

GPT-6 Sol/Luna and documented 6.1 Terra support sampling at `none`; Astra/6.1 Sol do
not accept `none`. Active reasoning disallows sampling controls. Terra facts do not
add a model to the registry or establish other capabilities. Other static registry
facts remain conservative. [OpenAI parameter guidance](https://developers.openai.com/api/docs/guides/latest-model#gpt-6-astra-update-api-and-model-parameters),
checked 2026-10-28. Custom gateways do not inherit official endpoint facts.

Selected native counting validates constraints before projecting input-bearing
fields; generation-only temperature need not be sent to the counting endpoint.
Existing native replay restrictions still reject unsupported native item kinds, including configuration updates; policy selection does not broaden those ownership contracts. An ordinary legacy count still behaves as before. Counting success does not certify
all dispatch, authentication or capacity constraints. Raw Responses WebSocket keeps
its existing strict validator and has no normalized-temperature policy selection.
Pure Chat Completions assessment does not add a Chat Completions transport. Helpers
retain their existing explicit configuration/validation contracts.

`observe` receives a bounded detached decision (model, named vendor, endpoint,
action, effective effort and closed reason code), never prompts or credentials.
Failures/rejected observers are isolated. Decisions can occur for preparation/count
as well as dispatch; they are not billable-call counters or completion proof.
There is no global decision journal. Hosts own retention and presentation.

Policy callbacks are host authority. Runtime snapshots include them only in the
host-local view; portable v2 exports omit the policy before traversal. Receiving
hosts reconfigure it explicitly. Old package/session DTOs and default hooks/events
remain unchanged. ICOS must keep its guard until explicitly adopting this contract;
static model-only omission can remain conservative. AMOS has no policy selector,
and its defaults are unchanged.

Run `npm run example:parameter-policy` for actual mocked Responses bodies, high
reasoning omission, supported zero at none, explicit raw rejection and immutable
saved temperature. It performs no network IO. Tests cover actual generation,
streaming, count and batch builders, routing/fallback and native effort updates.
Live testing remains paused by user instruction.
