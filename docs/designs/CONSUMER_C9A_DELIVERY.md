# C9-A — sparse endpoint capability companions

Stage-entry API (2026-10-28): additive pure `getRealtimeModelCapabilities(query)`
and `getTranscriptionCapabilities(query)` on root and `/shared`. Queries name the
vendor explicitly and include actual transport/session mode. Custom endpoints
return unknown. Existing registry identities and declared features are projected;
no prices, limits, defaults or full table are copied.

Realtime results distinguish reasoning support from its exact allowed effort set:
`reasoning.support` is supported/unsupported/unknown; `allowedEfforts: null` means
unknown, while an empty array denotes explicitly unsupported reasoning. Verified
sets include documentation provenance/date. GPT-Realtime-2's five documented
efforts are published. Current 2.1/2.1-mini model pages establish reasoning, but
not exact effort sets: those stay unknown, with no extrapolation or provider probe.

Transcription queries separate file, dedicated transcription-session and
conversation-input modes. File facts project current STT endpoint metadata.
Documented realtime constraints are sparse: committed gpt-transcribe requires
WebSocket; gpt-live-transcribe dedicated sessions require VAD off. Unverified
conversation/transcription model pairings remain unknown, including known registry
models where no exact pairing was documented. No Cartesian capability matrix,
configuration migration, raw registry change or stronger session rejection occurs.

Sources fetched from official OpenAI documentation on 2026-10-28:
[reasoning efforts](https://developers.openai.com/api/docs/guides/voice-prompting#set-reasoning-effort),
[transcription](https://developers.openai.com/api/docs/guides/realtime-transcription),
[2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1),
[2.1-mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini).
Live probes are paused by user instruction. AMOS has no Realtime selector; no voice
UI is added. ICOS selector adoption and pin upgrades remain separate consumer work.

Delivery/review: all 9,114 units (24 new cases), 21 built root/shared ESM/CJS/browser
assertions, build, types, lint, compatibility, examples and generated API pass.
Review added defensive unknown handling for invalid JavaScript endpoint/mode/
transport inputs and verified registry JSON remains unchanged. Exact 2.1 and mini
effort sets remain open coverage exclusions; no live probe or all-model support
claim is made. [Machine evidence](../evaluations/CONSUMER_C9A_VALIDATION_2026_10_28.json).
