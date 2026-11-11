# Model Registry Sources

Reference document for updating ALL model registries: LLM (`Model.ts`), Image (`ImageModel.ts`), Video (`VideoModel.ts`), TTS (`TTSModel.ts`), STT (`STTModel.ts`), and embeddings (`EmbeddingModel.ts`). Catalog discovery/lifecycle audited 2026-11-11; individual records retain their own verification dates. See [the November audit](../../../docs/MODEL_REGISTRY_REFRESH_2026_11_11.md) for additions, changed prices and adapter boundaries.

---

## OpenAI

### LLM Models (`Model.ts`)
- **Models page**: https://developers.openai.com/api/docs/models
- **Pricing page**: https://developers.openai.com/api/docs/pricing
- **Deprecations**: https://developers.openai.com/api/docs/deprecations
- **API reference**: https://developers.openai.com/api/reference
- **Key fields**: context window, max output tokens, pricing (input/cached/output), knowledge cutoff, supported features (vision, audio, reasoning, structured output, function calling)
- **Current additions**: GPT-6.1 Terra, GPT-6 Cyber, GPT-6 Astra/Sol/Luna, GPT-5.6 Cyber, and GPT-Rosalind Research. Verify access scope as well as ordinary capabilities.
- **Notes**: Cache discounts and cache-write rates are model-specific. GPT-6
  sampling controls depend on effective reasoning effort: Sol/Luna allow them
  only with `none`, while Astra and GPT-6.1 Sol do not support `none`.

### Image Models (`ImageModel.ts`)
- **Image guide**: https://platform.openai.com/docs/guides/images
- **Models**: GPT Image 2.6 and 2.5 Sunburst/Flare; deprecated `gpt-image-2` and GPT Image 1.5/mini; retired GPT Image 1 and DALL-E records
- **Key fields**: sizes, max images per request, quality levels, output formats, editing/variation support

### Video Models (`VideoModel.ts`)
- **Video guide**: https://developers.openai.com/api/docs/guides/video-generation
- **API reference**: https://developers.openai.com/api/reference/resources/videos
- **Models**: `sora-2`, `sora-2-pro`
- **Lifecycle**: both models and the Videos API retired 2026-09-24
- **Key fields**: durations, resolutions, fps, audio support, per-second pricing

### TTS Models (`TTSModel.ts`)
- **TTS guide**: https://platform.openai.com/docs/guides/text-to-speech
- **Models**: `gpt-4o-mini-tts` (instruction-steerable), `tts-1`, `tts-1-hd`; all deprecated with 2027-01-06 shutdown. Their Realtime replacement is not a Speech API drop-in.
- **Key fields**: voices, formats, max input length, per-1k-character pricing

### STT Models (`STTModel.ts`)
- **STT guide**: https://platform.openai.com/docs/guides/speech-to-text
- **Models**: `gpt-transcribe`, `gpt-4o-mini-transcribe`, `gpt-live-transcribe`, `gpt-realtime-whisper`, `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`, `whisper-1`
- **Key fields**: input formats, output formats, max file size, per-minute pricing

---

## Anthropic

### LLM Models (`Model.ts`)
- **Models overview**: https://platform.claude.com/docs/en/models/overview
- **Fable/Mythos 5.2 and Haiku 5.5**: https://platform.claude.com/docs/en/models/fable-5-2/overview and https://platform.claude.com/docs/en/models/haiku-5-5/overview
- **Opus 5.5**: https://platform.claude.com/docs/en/models/opus-5-5/overview
- **Sonnet 5.5**: https://platform.claude.com/docs/en/models/sonnet-5-5/overview
- **Fable 5.1**: https://platform.claude.com/docs/en/models/fable-5-1/overview
- **Mythos 5.1**: https://platform.claude.com/docs/en/models/mythos-5-1/overview
- **Pricing page**: https://platform.claude.com/docs/en/about-claude/pricing
- **Release notes**: https://platform.claude.com/docs/en/release-notes/overview
- **Deprecations**: https://platform.claude.com/docs/en/about-claude/model-deprecations
- **Key fields**: context window (1M for the current models; legacy models differ), max output, pricing (input/cached/output), extended thinking support
- **Notes**: Current adaptive-thinking models accept model-specific effort levels. Opus 5.5 is always adaptive; Sonnet 5.5 supports adaptive and `between_tools` under its published effort constraints. Prompt caching uses `cache_control` blocks.

---

## Google (Gemini)

### Main Pages
- **Models overview (START HERE)**: https://ai.google.dev/gemini-api/docs/models
- **Pricing page**: https://ai.google.dev/gemini-api/docs/pricing
- **Release notes**: https://ai.google.dev/gemini-api/docs/changelog
- **Deprecations**: https://ai.google.dev/gemini-api/docs/deprecations

### LLM Model Detail Pages
- **Gemini 4 Carbon / Argon**: https://aistudio.google.com/docs/models/gemini-4-carbon and https://aistudio.google.com/docs/models/gemini-4-argon
- **Pricing dates**: Gemini 4 introductory prices end 2026-11-30; Gemini 3.8 TTS introductory prices end 2026-12-31.
- **Gemini 3.8 Flash**: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash
- **Gemini 3.7 Flash**: https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash
- **Gemini 3.1 Pro Preview**: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview
- **Gemini 3 Flash**: https://ai.google.dev/gemini-api/docs/models/gemini-3-flash
- **Gemini 3 Pro Preview** (DEPRECATED): https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-preview
- **Gemini 2.5 Pro**: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
- **Gemini 2.5 Flash**: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
- **Gemini 2.5 Flash Lite**: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite
- **Key fields per page**: model ID, input/output token limits, supported modalities (text/image/audio/video), features (function calling, structured output, thinking, caching, batch API, search grounding, code execution, Live API), knowledge cutoff, latest update date

### Image Models (`ImageModel.ts`)
- **Imagen 4 guide**: https://ai.google.dev/gemini-api/docs/imagen
- **Nano Banana (Gemini 2.5 Flash Image)**: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image
- **Nano Banana Pro (Gemini 3 Pro Image)**: https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image-preview
- **Nano Banana 2 (Gemini 3.1 Flash Image)**: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image-preview
- **Models**: current native-image models including Gemini Nano Banana 2.1 and the Gemini 3.1/3 Pro image families; retired Imagen 4 records; deprecated `gemini-2.5-flash-image`
- **Key fields**: aspect ratios, resolution tiers (0.5K/1K/2K/4K), max prompt tokens, per-image pricing (varies by resolution for Nano Banana), editing support
- **Notes**: Imagen 4 supports English-only prompts, max 480 token prompt. Nano Banana models are Gemini-based with larger context windows (65K-131K). Nano Banana 2 supports up to 4K resolution. Nano Banana Pro has reasoning/thinking capabilities.

### Video Models (`VideoModel.ts`)
- **Video guide**: https://ai.google.dev/gemini-api/docs/video
- **Models**: `gemini-omni-1.2-flash`, legacy `gemini-omni-1.1-flash`, retired Omni Flash Preview and Developer API Veo variants (Cloud Veo is separate)
- **Key fields**: durations (4/6/8s), resolutions (720p/1080p/4K), aspect ratios, audio support, per-second pricing
- **Notes**: Veo 2 only supports 720p, no audio, no reference images. Veo 3.1 supports native audio, reference images (up to 3), video extension. 1080p/4K require 8s duration. Pricing varies by resolution tier (720p/1080p vs 4K).

### TTS Models (`TTSModel.ts`)
- **Speech generation guide**: https://ai.google.dev/gemini-api/docs/speech-generation
- **Flash TTS detail**: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-preview-tts
- **Models**: Gemini 3.8 Flash/Flash-Lite TTS, `gemini-3.1-flash-tts-preview`, and maintained Gemini 2.5 preview entries
- **Key fields**: 30 prebuilt voices, 70+ languages, 32K token context window, PCM output (24kHz 16-bit mono), max 2 speakers per session
- **Pricing**: Token-based (not character-based like OpenAI). Flash: $0.50/$10 per 1M tokens in/out. Pro: $1/$20 per 1M tokens.

### Speech-to-Text Models (`STTModel.ts`)
- **Audio transcription**: https://ai.google.dev/gemini-api/docs/transcribe
- **Models**: `gemini-3.5-transcribe`, `gemini-3.5-transcribe-live`, plus general-purpose `gemini-3.6-flash`

### Live Audio Models
- **Native Audio Preview**: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-native-audio-preview
- **Models**: Gemini 3.8 Live and Live Extended Thinking are in the LLM registry; older native-audio previews remain lifecycle records rather than traditional TTS entries.

### Music Models (not yet in registry)
- **Music generation**: https://ai.google.dev/gemini-api/docs/music-generation
- **Models**: `lyria-3.5-clip-preview` and `lyria-3.5-pro-preview` are the current public-preview music models; Lyria endpoints remain outside the existing capability registries because OneRingAI has no music-generation surface yet.

---

## xAI (Grok)

### LLM Models (`Model.ts`)
- **Models page**: https://docs.x.ai/developers/models
- **Pricing**: https://docs.x.ai/developers/pricing
- **Release notes**: https://docs.x.ai/developers/release-notes
- **Key fields**: context window (up to 2M), max output, pricing (input/cached/output), vision support, reasoning
- **Current addition**: [Grok 4.7](https://docs.x.ai/developers/grok-4-7) with Responses, X/web search, hosted code execution, 500K context, and long-context pricing.
- **Notes**: Fast variants are available for selected models and Grok Code is specialized for coding. Prompt caching and batch availability are model-specific; current Grok 4.7/4.6 entries do not expose batch processing.

### Image Models (`ImageModel.ts`)
- **Image generation guide**: https://docs.x.ai/docs/guides/image-generation
- **Models**: `grok-imagine-image-2.0`, `grok-imagine-image-quality`, `grok-imagine-image`; retired `grok-2-image-1212`
- **Key fields**: aspect ratios, resolutions (1K/2K), quality tiers, max images per request, and tiered per-image pricing
- **Notes**: `grok-imagine-image-quality` retired 2026-11-02 and redirects; migrate to `grok-imagine-image-2.0` with low quality. `grok-imagine-image` remains active. Generated URLs are temporary.

### Video Models (`VideoModel.ts`)
- **Video generation guide**: https://docs.x.ai/docs/guides/video-generations
- **Models**: `grok-imagine-video-1.5`, `grok-imagine-video`
- **Key fields**: durations (1-15s), resolutions through native 1080p on Video 1.5, aspect ratios, audio support, and per-second pricing

### Speech Models (`TTSModel.ts`, `STTModel.ts`)
- **Text to speech**: https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
- **Speech to text**: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
- **Models**: model-less `xai-tts`/`xai-stt`, Grok Voice Transcribe 2.0, and maintained transcription records; `grok-voice-3.0` owns `grok-voice-latest` in the LLM registry

---

## Groq

### STT Models (`STTModel.ts`)
- **Speech-to-text docs and pricing**: https://console.groq.com/docs/speech-to-text
- **Models**: `whisper-large-v3`, `whisper-large-v3-turbo`; retired `distil-whisper-large-v3-en`
- **Key fields**: per-hour pricing converted to per-minute, 100 MB developer file limit, word and segment timestamps

---

## DeepSeek

- **Models and pricing**: https://api-docs.deepseek.com/quick_start/pricing/
- **Release updates**: https://api-docs.deepseek.com/updates/
- **Vision guide**: https://api-docs.deepseek.com/guides/vision/
- **Responses API**: https://api-docs.deepseek.com/guides/responses_api/
- **Models**: `deepseek-flash` (V4.1 Flash 1017) and `deepseek-v4-pro`; old Flash/vision records are retired and vendor-redirected
- **Pricing note**: registry base token rates are peak rates; `processingMultipliers.off_peak` represents the documented 50% off-peak reduction

---

## Mistral and Ollama embeddings

- **Mistral models**: https://docs.mistral.ai/models
- **Codestral Embed**: https://docs.mistral.ai/models/codestral-embed-25-05
- **Ollama embeddings**: https://docs.ollama.com/capabilities/embeddings
- **Ollama model metadata**: https://ollama.com/library/embeddinggemma and https://ollama.com/library/all-minilm

---

## Compatible-host LLM catalogs

- Groq: https://console.groq.com/docs/models
- Mistral: https://docs.mistral.ai/models
- Together: https://docs.together.ai/docs/serverless/models
- Perplexity: https://docs.perplexity.ai/docs/agent-api/models and https://docs.perplexity.ai/docs/agent-api/openai-compatibility
- Ollama: https://ollama.com/library?sort=newest and https://docs.ollama.com/api/openai-compatibility
- Google Cloud deployment catalog: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/google-models

Metadata discovery is separate from implemented endpoint/adapter support; see the November audit.

---

## Update Checklist

When updating the registries:

1. **Start with the vendor's main models page** — check for new models, deprecations, status changes
2. **Follow detail links for each model** — get exact token limits, features, capabilities
3. **Check the pricing page** — verify all pricing (input/cached/output, per-image, per-second, etc.)
4. **Update constants** — `LLM_MODELS`, `IMAGE_MODELS`, `VIDEO_MODELS`, `TTS_MODELS`, `STT_MODELS`
5. **Update registry entries** — add new models, fix existing ones
6. **Update test files** — counts, assertions, cost calculations
7. **Run verification**:
   ```bash
   npm run typecheck
   npm run test:unit -- tests/unit/domain/entities/Model.test.ts
   npm run test:unit -- tests/unit/image/ImageModel.test.ts
   npm run test:unit -- tests/unit/video/VideoModel.test.ts
   npm run test:unit -- tests/unit/audio/TTSModel.test.ts
   ```
8. **Update CHANGELOG.md**
9. **Update `lastVerified` dates** on all touched registry entries
