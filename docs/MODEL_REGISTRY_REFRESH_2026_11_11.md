# Model registry refresh — November 11, 2026

This catalog audit applies to `main` (v2) and `version1` (v1). It checks current
vendor catalogs, model pages, prices and lifecycle notices. It does not publish a
package, establish account access, or claim authenticated live-provider validation.
Historical records and exported identifiers remain available for lookup.

## Catalog changes

| Registry | Before | After | Changes |
| --- | ---: | ---: | --- |
| LLM / multimodal / realtime | 110 | 137 | 27 additions; lifecycle, alias and price corrections |
| Images | 23 | 25 | GPT Image 2.6 Sunburst and Flare; Nano Banana pricing and lifecycle corrections |
| Video | 10 | 11 | Gemini Omni 1.2 Flash; Developer API Veo retirement |
| Text to speech | 9 | 9 | OpenAI shutdown notices; current Gemini TTS prices |
| Speech to text | 15 | 15 | Rechecked current OpenAI, Google, xAI and Groq families |
| Embeddings | 15 | 16 | Separate retired Gemini Embedding 2 Preview redirect record |

New LLM entries:

- OpenAI: `gpt-6.1-terra`, organization-gated `gpt-6-cyber`.
- Anthropic: `claude-fable-5-2`, verification-gated `claude-mythos-5-2`,
  `claude-haiku-5-5`. Fable/Mythos 5.1 remain historical, callable legacy entries.
- Google: `gemini-4-carbon`, `gemini-4-argon`, with text, image, audio and video
  input. The normal synchronous output limit remains 65,536; the vendor's optional
  long-decode workflow is not automatically enabled by a registry entry.
- xAI: `grok-voice-3.0`, deprecated `grok-voice-2.0`.
  `grok-voice-latest` now resolves to 3.0. Older versioned IDs stay distinct.
- DeepSeek: `deepseek-flash`, currently DeepSeek V4.1 Flash 1017. The retired V4
  Flash and experimental vision models have separate records and a replacement;
  the vendor accepts their old slugs and redirects them at current Flash prices.
- Groq: hosted GPT-OSS 120B and Qwen 3.8 27B (preview).
- Mistral: Large 4 and Small 4.
- Together: the current DeepSeek Flash/Pro, Kimi K3.1 Pro, MiniMax M3.1 Flash,
  Muse Spark Open, Nemotron 3.5 Super VL, Qwen 3.8 Flash, GLM 5.3/5.3 Flash and
  Beam 1.0 families, using Together's exact hosted identifiers and token prices.
- Perplexity: `perplexity/sonar`, on its Agent/Responses API. Its API base URL is
  `https://api.perplexity.ai/v1`; configure that explicitly for this newer endpoint.
- Ollama: local `ripple-preview` and `lfm3-vl`. Local zero API token fees exclude
  hardware/runtime costs. LFM3-VL video support is announced as forthcoming and is
  deliberately not marked available.

Curated compatible-host records describe vendor metadata. They do not imply that
every optional endpoint/tool works through every OneRingAI adapter. Mistral's
records declare Chat Completions; the existing generic text adapter uses Responses.
Selecting these records alone does not add a Mistral Chat Completions transport.
DeepSeek Flash vision is vendor metadata; the current DeepSeek adapter still
rejects image/file input.
Together and Groq hosted features likewise require endpoint-specific verification.
Unknown published output limits stay `null`, and unspecified features stay unknown.
The global registry cannot represent two hosts under one identical model ID;
`openai/gpt-oss-120b` is curated for Groq, while `gpt-oss-120b` is the separate
OpenAI open-weight record. This audit does not introduce provider-scoped lookup.

## Lifecycle and pricing corrections

- OpenAI: GPT-4.1 Nano and GPT Image 1 are retired. GPT Image 2 is deprecated on
  November 10, with February 10, 2027 shutdown. GPT-4.1/mini and GPT-4o/mini have
  January 14, 2027 shutdown notices. GPT-5.1, GPT-5.3 Codex and GPT-5.4 Nano have
  April 1, 2027 shutdown notices.
- OpenAI Speech API: `tts-1`, `tts-1-hd` and `gpt-4o-mini-tts` retire January 6,
  2027. The recommended replacement, `gpt-realtime-2.1-mini`, uses the Realtime
  API; it is not registered as a drop-in `/audio/speech` model.
- Google: stable Nano Banana 2 remains active; remove its incorrect October 29
  shutdown date. Gemini 2.5 Flash Image remains callable until March 15, 2027.
  Veo 3.1 Developer API previews retired October 22. Cloud-hosted Veo is a separate
  deployment and is not declared retired by that notice. Omni Flash Preview has
  retired; Omni 1.1 remains callable and routes to 1.2 starting December 3.
- Google embeddings: the Preview ID routes to stable Embedding 2 since November 6;
  it no longer appears as a separate active model. Rechecked multimodal rates.
- xAI: Imagine Image Quality retired November 2. Its accepted slugs redirect to
  Imagine Image 2.0 at low quality; historical prices remain historical metadata.
  Rechecked Imagine Video 1.5's resolution prices and Voice Transcribe 2.0.
- Anthropic: Sonnet 5.5 cache reads cost $0.10/MTok. Haiku 5.5's higher all-token
  price tier applies strictly above 100,000 input tokens; the test covers both
  sides of that boundary.
- Nano Banana 2.1: $1.50/MTok text/image input and $30/MTok image output. Output
  image estimates use the published token counts: $0.0336 at 1K, $0.0504 at 2K,
  $0.1134 at 4K (the price table rounds the last amount to $0.113).
- Omni 1.2 video estimates multiply the published output tokens/second by
  $12/MTok. They exclude input tokens, text output and other separately billed
  services, and are not provider invoices.

Time-limited rates in this snapshot need a later refresh:

| Models | Rates in this snapshot | Announced change |
| --- | --- | --- |
| Gemini 4 Carbon / Argon | $2 input, $0.10 cache read, $10 output per MTok | Double on December 1, 2026 |
| Gemini 3.8 Flash TTS | $0.50 text input, $9 audio output per MTok | Double on January 1, 2027 |
| Gemini 3.8 Flash-Lite TTS | $0.50 text input, $6 audio output per MTok | Double on January 1, 2027 |

These are explicit snapshot rates, not an automatic date-dependent pricing system.

## Adapter and support boundaries

Small model-family updates route Gemini 4 through the existing Interactions path,
map its documented thinking levels in both Google converters, and route Omni 1.2
video generation through Interactions. Claude Haiku 5.5 uses adaptive thinking,
native structured output and its published disabled-thinking effort constraints.
Fable/Mythos 5.2 retain adaptive thinking. Existing defaults remain unchanged.

The broader catalogs were checked for unsupported media as well: Mistral Voxtral
TTS/Transcribe 3, Groq Orpheus, Together image/video/audio models and Ollama native
omni/audio models need capabilities/transports outside the currently implemented
media factories. They are not presented as supported OneRingAI media integrations.
Groq's existing Whisper registry metadata likewise does not implement the factory's
currently missing Groq STT adapter. Lyria music has no existing registry surface.
Google Cloud was checked independently; shared Gemini IDs are not duplicated with
conflicting provider ownership in the global registry.

## Sources

- OpenAI: [catalog](https://developers.openai.com/api/docs/models),
  [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra),
  [Cyber](https://developers.openai.com/api/docs/models/gpt-6-cyber),
  [image guide](https://developers.openai.com/api/docs/guides/image-generation),
  [prices](https://developers.openai.com/api/docs/pricing),
  [deprecations](https://developers.openai.com/api/docs/deprecations),
  [speech guide](https://developers.openai.com/api/docs/guides/text-to-speech).
- Anthropic: [catalog](https://platform.claude.com/docs/en/models/overview),
  [Fable 5.2](https://platform.claude.com/docs/en/models/fable-5-2/overview),
  [Mythos 5.2](https://platform.claude.com/docs/en/models/mythos-5-2/overview),
  [Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview),
  [effort](https://platform.claude.com/docs/en/build-with-claude/effort).
- Google: [catalog](https://aistudio.google.com/docs/models),
  [Carbon](https://aistudio.google.com/docs/models/gemini-4-carbon),
  [Argon](https://aistudio.google.com/docs/models/gemini-4-argon),
  [Omni](https://aistudio.google.com/docs/models/gemini-omni-flash),
  [prices](https://aistudio.google.com/docs/pricing),
  [lifecycle](https://aistudio.google.com/docs/deprecations),
  [changelog](https://aistudio.google.com/docs/changelog),
  [Cloud catalog](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/google-models).
- xAI: [catalog](https://docs.x.ai/developers/models),
  [release notes](https://docs.x.ai/developers/release-notes),
  [voice](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech),
  [video](https://docs.x.ai/developers/models/grok-imagine-video-1.5),
  [STT](https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
- [DeepSeek models and prices](https://api-docs.deepseek.com/quick_start/pricing/).
- Groq: [catalog](https://console.groq.com/docs/models),
  [GPT-OSS](https://console.groq.com/docs/model/openai/gpt-oss-120b),
  [Qwen](https://console.groq.com/docs/model/qwen/qwen3.8-27b),
  [speech](https://console.groq.com/docs/text-to-speech).
- Mistral: [catalog](https://docs.mistral.ai/models),
  [Large 4](https://docs.mistral.ai/models/mistral-large-4-0),
  [Small 4](https://docs.mistral.ai/models/mistral-small-4-0-26-03).
- [Together hosted catalog and prices](https://docs.together.ai/docs/serverless/models).
- Perplexity: [models](https://docs.perplexity.ai/docs/agent-api/models),
  [endpoint compatibility](https://docs.perplexity.ai/docs/agent-api/openai-compatibility),
  [Sonar migration](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview).
- Ollama: [newest catalog](https://ollama.com/library?sort=newest),
  [Ripple](https://ollama.com/library/ripple-preview),
  [LFM3-VL](https://ollama.com/library/lfm3-vl),
  [endpoint support](https://docs.ollama.com/api/openai-compatibility),
  [embeddings](https://docs.ollama.com/capabilities/embeddings).

## Validation

Both branches passed build/export verification, TypeScript, ESLint, example
compilation and regenerated public/internal API references. The shared registry
refresh tests and affected provider tests passed on both branches.

The complete unit sweeps exercised 9,513 tests on main and 6,741 on version1.
The initial sandboxed runs could not open localhost listeners; those affected
HTTP/MCP/WebSocket suites passed when rerun with local networking. The main sweep
also exposed a Terra `none`-effort sampling omission introduced by adding its
registry record; its metadata was corrected and the entire parameter-policy suite
passed on rerun. These are sweep-plus-rerun results, not a claim that the initial
sandboxed sweeps were entirely green.

V2 additionally passed the documentation checker, page/Worker declaration checks,
the offline browser/Node example and Chromium/Firefox/WebKit page/Worker scenarios.
V1 has no documentation-checker script. No billable provider tests were run.
