# Endpoint capability companions

C9-A adds pure `getRealtimeModelCapabilities(query)` and
`getTranscriptionCapabilities(query)` on root and `@everworker/oneringai/shared`.
They do no network IO and import no provider SDK or Node runtime in browser bundles.
They do not replace model/STT registries, infer vendor from model text or change
legacy Realtime validation, settings, registry objects or STT streaming behavior.

```typescript
import { Vendor, getRealtimeModelCapabilities, getTranscriptionCapabilities }
  from '@everworker/oneringai/shared';
const voice = getRealtimeModelCapabilities({
  vendor: Vendor.OpenAI, model: 'gpt-realtime-2', transport: 'webrtc',
});
const input = getTranscriptionCapabilities({
  vendor: Vendor.OpenAI, model: 'gpt-transcribe', mode: 'conversation-input',
  transport: 'websocket', conversationModel: 'gpt-realtime-2.1',
});
```

Reasoning support and exact allowed efforts are separate. `support` distinguishes
supported/unsupported/unknown. `allowedEfforts: null` explicitly means the exact set
is unverified; an empty array means reasoning is explicitly unsupported. Existing
saved efforts remain host-owned and visible even when absent from a verified set.
Metadata does not silently migrate settings or enforce a stronger validator.

For the official endpoint, GPT-Realtime-2 has the documented `minimal`, `low`,
`medium`, `high`, `xhigh` set. The 2.1/2.1-mini model pages establish reasoning but
not their exact effort sets, so those sets remain unknown. Provenance distinguishes
checked documentation from projected existing registry declarations.
[OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/voice-prompting#set-reasoning-effort),
[2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1),
[2.1-mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini).
Facts were checked on 2026-10-28; no live model probes were run.

Transcription modes are `file`, `transcription-session`, and `conversation-input`.
File support projects existing declared audio-transcription endpoints. Dedicated
`gpt-transcribe` committed-turn sessions require WebSocket; WebRTC/SIP are explicitly
unsupported for that documented workflow. Dedicated `gpt-live-transcribe` supports
WebSocket/WebRTC with VAD omitted or off; `server_vad` and `semantic_vad` are
unsupported. Exact conversation/transcription model pairings stay unknown when
unverified, including the example above. A required transport does not prove an
unlisted pairing works. [OpenAI transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription).

Unknown models, vendors and custom endpoints stay unknown. Set the query's
`endpoint: 'custom'` for a custom gateway even if its model name matches an OpenAI
model. Defaults describe the named vendor's official endpoint. There is no automatic
network research, Cartesian product table or generic capability-rule language.

Run `npm run example:endpoint-capabilities` for all three support states and the
known-versus-unknown effort distinction. AMOS has no Realtime selector and receives
no voice UI here. ICOS must explicitly adopt these lookups while preserving saved
values and its host authorization/custom-service rules; an SDK pin alone does not
change selector choices. A package release is not implied by branch availability.
