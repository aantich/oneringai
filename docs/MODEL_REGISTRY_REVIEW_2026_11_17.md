# Model registry review — November 17, 2026

This follow-up to the [November 11 audit](MODEL_REGISTRY_REFRESH_2026_11_11.md)
reviews all named vendors and all six existing catalogs on `main` and
`version1`. Entries describe documented vendor metadata; they do not establish
account entitlement, implemented endpoint support or live-provider validation.
The package versions and published November 11 release receipts are unchanged.

## Changes

The LLM catalog grows from **137 to 144** entries and video from **11 to 12**.
Images remain 25, TTS 9, STT 15 and embeddings 16.

| Vendor | Added or corrected |
| --- | --- |
| OpenAI | Add `gpt-6-rosalind`, a separately approved Research API model announced October 30 and missed by the earlier curation. Standard prices are $15 input / $1.50 cache read / $75 output per MTok; above 272,000 input tokens, $30 / $3 / $112.50. Context/output limits and model-specific endpoints/tool controls remain unknown. Cache-write quotes describe the published 30-minute tier, not the distinct 12-hour tier. |
| Google | Add GA `gemini-4-hydrogen` (November 12): 1,048,576 unified context, 65,536 synchronous output, text/image/audio/video/PDF input and text output. Standard input/cache/output prices are $1.50/$0.075/$7.50 per MTok. Cache support is implicit only. Preserve `xhigh`, use its default `high`, and map weaker neutral effort requests to `low` on both Google endpoints. |
| Google Cloud | Independently confirm Hydrogen in the Cloud catalog. Shared Gemini IDs retain their existing Google registry owner; no conflicting duplicate provider entry is created. |
| Together | Add `thinkingmachines/Inkling-2-Small` (November 12), text/image input, 1,048,576 context and $0.30/$0.03/$1 input/cache/output per MTok. Add the previously missed `elorian-labs/glimpse-1.0` (November 10), 262,144 context and $0.60/$0.06/$3. Output ceilings stay unknown. |
| Ollama | Add `inkling-2-small`, with `inkling-2-small:cloud` as an alias. This is billed cloud inference, with the published $0.30/$0.03/$1 rates, requiring an Ollama cloud key or authenticated local proxy. It is not a zero-fee local model. |
| Perplexity | Add the separately owned `google/gemini-4-hydrogen` Agent API ID with its published $1.50/$0.075/$7.50 prices. Do not infer host context/output limits or optional modalities from the Google endpoint. Configure the Agent API base URL `https://api.perplexity.ai/v1`. |
| Groq | Add the current production `openai/gpt-oss-20b`: 131,072 context, 65,536 completion, text-only input, tool/schema support and low/medium/high reasoning. Published input/cache/output prices are $0.075/$0.037/$0.30 per MTok; the cache value is the model card's rounded figure. |
| xAI | Add `grok-imagine-video-1.5-lite`: 1–15 seconds, generated speech/audio, text/image input, 480p/720p/1080p with 1080p upscaled from 720p. Rates are $0.02/$0.03/$0.14 per second, plus $0.01 for an input image. Lite does not offer reference collections, pinned frames, editing or extension. |
| xAI | Current docs support text-to-video on both Video 1.5 variants. Remove the outdated image-required provider guard, include Lite in discovery, accept all 1–15 second durations for 1.5, and record 1.5's pinned-frame capability. Lite's unpublished FPS limit uses the documented `maxFps: 0` unknown sentinel rather than an invented rate. Existing numeric FPS fields remain compatible. |
| xAI | Grok 4.6/4.7 now advertise vendor Batch API support: apply the published 0.8 batch multiplier and 2x priority rate. The normalized OneRingAI Grok batch transport still reports unsupported; catalog support is not adapter implementation. |
| Mistral | Record Large 4 always-on reasoning and the documented `low`/`medium`/`high` efforts; `none` is unsupported. Keep its unknown output ceiling and Chat Completions endpoint boundary. |

The previous Together endpoint declarations were too broad. The vendor's
Responses/Messages allowlist currently contains GLM 5.2, GLM 5.3, GLM 5.3 Flash
and DeepSeek V4.1 Flash 1017. Of the curated records, only the latter three
advertise those endpoints; the rest declare Chat Completions. Their documented
image input is also recorded for DeepSeek Flash 1017 and GLM 5.3 Flash. The generic
OneRingAI adapter still uses Responses, so registering Inkling or Glimpse does
not implement a Together Chat Completions transport. Defaults are unchanged.

Hydrogen's million-token long-decode workflow is separate from ordinary
synchronous output. This update does not enable background/continuation or
explicit prompt-cache writes. Carbon/Argon introductory prices still change on
December 1; Gemini 3.8 TTS rates still change on January 1, as documented in the
November 11 audit. No future price increase is applied early.

## Reviewed without new generative-media registrations

- **Anthropic:** current Fable/Mythos 5.2 and Opus/Sonnet/Haiku 5.5 already exist.
  November 12's self-hosted Managed Agents and November 16's watermark update
  add no new generative model identifier or catalog price in the checked lineup.
- **OpenAI:** GPT Image 2.6, Live, Realtime and transcription families and existing
  retirement notices remain current. The November 16 `omni-moderation-csam-latest`
  classifier uses Moderations, requires approved access and is not an image
  generator or chat model; no moderation registry/transport is added here.
- **Google:** Gemini 3.8 TTS, Omni 1.2 video, current image families and Embedding 2
  remain current in their catalogs. The new `gemini-decision-1` is Decisions-only,
  returns probabilities with zero generated tokens, and is not an Agent text model.
- **DeepSeek:** the November 13 application APIs add search, URL/file handling,
  safety, ASR and TTS. Existing Flash/Pro model IDs and token prices are unchanged.
  TTS uses the model-less `/v1/tools/tts` contract (not `/audio/speech`). Current
  media factories and DeepSeek's text adapter do not gain these integrations.
- **Perplexity/Ollama decision models:** the new Perplexity v1.3 decision aliases
  and decision-only Ollama models are specialized scoring surfaces, not ordinary
  text generation. No unsupported decision transport is advertised.
- **Other hosted media:** Mistral Voxtral, Groq Orpheus and Together's image,
  video/audio catalog remain outside implemented media factories. Ollama's
  EmbeddingGemma 2 was reviewed: its model card says 8,192 context while its tag
  summary says 256K, and its modular media encoders differ by variant. It is not
  assigned a guessed embedding context or new multimodal adapter in this update.
- **Custom endpoints:** have no authoritative universal catalog; explicit vendor,
  host model discovery and account-scoped capabilities remain the source of truth.

## Official sources

- OpenAI: [changelog](https://developers.openai.com/api/docs/changelog),
  [catalog](https://developers.openai.com/api/docs/models),
  [prices](https://developers.openai.com/api/docs/pricing),
  [Rosalind access and API ID](https://help.openai.com/en/articles/20001193-gpt-rosalind-for-life-sciences-research),
  [deprecations](https://developers.openai.com/api/docs/deprecations).
- Anthropic: [catalog](https://platform.claude.com/docs/en/models/overview),
  [release notes](https://platform.claude.com/docs/en/release-notes/overview),
  [lifecycle](https://platform.claude.com/docs/en/about-claude/model-deprecations).
- Google: [Hydrogen](https://aistudio.google.com/docs/models/gemini-4-hydrogen),
  [migration](https://aistudio.google.com/docs/whats-new-gemini-4-hydrogen),
  [prices](https://aistudio.google.com/docs/pricing#gemini-4-hydrogen),
  [thinking](https://aistudio.google.com/docs/thinking),
  [lifecycle](https://aistudio.google.com/docs/deprecations),
  [changelog](https://aistudio.google.com/docs/changelog),
  [Cloud catalog](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/google-models).
- xAI: [Video overview](https://docs.x.ai/developers/model-capabilities/video/overview),
  [generation](https://docs.x.ai/developers/model-capabilities/video/generation),
  [Lite prices](https://docs.x.ai/developers/models/grok-imagine-video-1.5-lite),
  [Grok 4.7](https://docs.x.ai/developers/models/grok-4.7),
  [Grok 4.6](https://docs.x.ai/developers/models/grok-4.6),
  [pricing](https://docs.x.ai/developers/pricing),
  [release notes](https://docs.x.ai/developers/release-notes).
- Together: [catalog/prices](https://docs.together.ai/docs/serverless/models),
  [changelog](https://docs.together.ai/docs/changelog),
  [Responses allowlist](https://docs.together.ai/docs/inference/responses-api).
- Ollama: [catalog](https://ollama.com/library?sort=newest),
  [Inkling cloud](https://ollama.com/library/inkling-2-small),
  [API compatibility](https://docs.ollama.com/api/openai-compatibility),
  [EmbeddingGemma 2](https://ollama.com/library/embeddinggemma-2).
- Perplexity: [model prices](https://docs.perplexity.ai/docs/agent-api/models),
  [changelog](https://docs.perplexity.ai/docs/resources/changelog).
- Groq: [catalog](https://console.groq.com/docs/models),
  [GPT-OSS 20B](https://console.groq.com/docs/model/openai/gpt-oss-20b),
  [Responses](https://console.groq.com/docs/responses-api).
- Mistral: [catalog](https://docs.mistral.ai/models),
  [changelog](https://docs.mistral.ai/resources/changelogs),
  [Large 4](https://docs.mistral.ai/models/mistral-large-4-0).
- DeepSeek: [updates](https://api-docs.deepseek.com/updates/),
  [model prices](https://api-docs.deepseek.com/quick_start/pricing/),
  [TTS contract](https://api-docs.deepseek.com/guides/tts/).

## Validation

Both working trees passed the final builds/export checks, TypeScript, ESLint,
example compilation and regenerated public/internal API references. The complete
final unit runs passed: **9,531 tests / 438 files on main**, **6,759 tests / 319
files on version1**. These runs allowed local mock HTTP/MCP/WebSocket listeners;
they did not call live providers. New cases cover Hydrogen request dispatch and
thinking/default/sampling controls, hosted identity/unknown limits, exact Rosalind
long-context prices, Together endpoint/image declarations, billed cloud aliases,
Grok batch estimates/transport boundaries and Video 1.5/Lite text-to-video.

V2 also passed documentation validation (509 TypeScript blocks, 18 complete
examples, 164 Markdown files), browser page/Worker declarations, the offline
browser/Node example, and Chromium/Firefox/WebKit strict-CSP page/Worker scenarios.
The shared model/video data, review and regression test are identical on both
branches; branch-specific provider/context behavior is preserved. No billable
provider calls, production OAuth tests, commits, pushes or new package publication
were performed as part of this review. Subsequent authorized releases are tracked
separately in the release validation records.
