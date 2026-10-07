# Model Registry and Provider API Audit — 2026-10-07

**Status:** implemented; authenticated vendor availability remains account-gated

This audit covers the current first-party model catalogs and materially new API
surfaces for OpenAI, Anthropic, Google, and xAI. The wider registry still
contains DeepSeek, Groq, Mistral, and Ollama records from the previous full
catalog audit. Official model pages, API guides, pricing pages, release notes,
and the installed first-party SDK types were treated as the sources of truth.

## Implemented registry changes

### OpenAI

- Added GPT-6.1 Sol, GPT-6 Sol, and GPT-6 Luna alongside GPT-6 Astra, with
  verified reasoning efforts, endpoints, context/output limits, cache-write and
  long-context pricing, processing tiers, and Responses extension flags.
- Added access-controlled GPT-5.6 Cyber (`gpt-daybreak-red-latest`) and
  GPT-Rosalind Research. Unknown published limits remain `null`; the registry
  does not invent them.
- Added the `gpt-daybreak-blue-latest` alias for GPT-5.6 Sol.
- Added GPT Image 2.5 Sunburst and Flare.
- GPT-6 context guardrails record the documented 1,050,000-token total context
  window. The 128,000-token output cap remains separate.

### Anthropic

- Added Claude Opus 5.5 and Sonnet 5.5 as preferred public models with 1M input
  context, 128K output, current pricing, and model-specific effort metadata.
- Marked Opus 5 and Sonnet 5 as legacy with 5.5 replacements. They remain
  callable; legacy is not treated as retired.
- Retained Fable 5.1 and Mythos 5.1 lifecycle/access metadata from the September
  refresh.

### Google

- Added Gemini 3.8 Flash, Gemini 3.8 Live, and Gemini 3.8 Live Extended
  Thinking, including Interactions/Live endpoints, multimodal capabilities,
  processing tiers, and pricing.
- Added Gemini Nano Banana 2.1 and Gemini 3.8 Flash/Flash-Lite TTS models.
- Updated replaced Live entries to point to Gemini 3.8 Live.

### xAI

- Added Grok 4.7 with its 500K context window, supported reasoning efforts,
  Responses endpoint, cache and long-context pricing, and current hosted-tool
  capabilities.
- Added Grok Voice Transcribe 2.0 and retained current xAI image, video, TTS,
  STT, and Voice Agent records.

## Implemented provider/API changes

### OpenAI

- Upgraded to `openai` 7.30.
- Managed Agent execution now preserves Responses reasoning and encrypted
  compaction items across tool turns. Direct and streaming continuations expose
  provider state without flattening it into visible text, and streaming replay
  retains the original cross-type output order.
- Native tools cover web search, Code Interpreter, file search, remote MCP,
  computer use, hosted shell, apply patch, tool search, and image generation on
  capability-declared models. Direct responses retain native call payloads,
  and typed computer/shell/patch/tool-search output items let trusted hosts
  continue client-executed tool loops without raw SDK calls.
- Added connector-first `OpenAIDecisions`, `OpenAILiveSession`, and
  `OpenAIVoices` wrappers.
- Existing Astra support remains: async function/custom tools, in-band
  `configuration_update`, explicit compaction, Responses WebSocket steering,
  and misalignment alert retrieval. EU Fast/priority validation covers all four
  current GPT-6 models, and EU Ultrafast requests are rejected before inference.
- Sampling validation follows the effective GPT-6 reasoning effort. Sol and
  Luna permit sampling only with `none`; Astra and GPT-6.1 Sol reject `none`.

### Anthropic

- Upgraded to `@anthropic-ai/sdk` 0.131.
- Added the current web search (`web_search_20260318`), web fetch
  (`web_fetch_20260318`), and code execution (`code_execution_20260521`) wire
  versions.
- Added deferred tool definitions, programmatic code-execution callers,
  regex/BM25 tool search, and server-side compaction request/response handling.
- Added model-specific validation: Opus 5.5 is always adaptive; Sonnet 5.5 uses
  adaptive or `between_tools`, with `between_tools` limited to `high` or lower.
- Claude Opus 5 `disabled` mode is likewise limited to `high` or lower, and
  contradictory provider-neutral thinking configurations fail locally.
- Unknown Anthropic provider blocks are stored as opaque provider state and
  replayed verbatim. This is required for correct tool-search and server-tool
  continuation, including streams.

### Google

- Upgraded to `@google/genai` 2.27.
- Gemini 3.5+ continues to use Interactions by default. Interactions now map
  continuation tokens, Gemini 3.8 file search, computer use, and file-search
  usage telemetry.
- Added connector-first `GoogleLiveSession`, including background interaction
  status, and `GoogleVoices` lifecycle access.
- Google TTS distinguishes built-in names from custom `voice_…`, `voicekey_…`,
  and `voices/…` identifiers. Its local voice list remains deterministic while
  `GoogleVoices` owns the remote custom catalog.
- Computer use intentionally remains host-executed. OneRingAI returns normal
  tool calls; the host owns confirmation, action execution, and screenshots.

### xAI

- Added a dedicated `GrokTextProvider` while retaining xAI's
  OpenAI-compatible Responses transport.
- The adapter advertises and maps xAI web search, X search, and hosted code
  execution only for registry-declared models; preserves reasoning state
  through tool turns; and converts native
  tool counts and provider-reported cost ticks.
- xAI-specific capabilities are not inferred from OpenAI model names.

## Compatibility and safety decisions

1. `Connector` remains the only credential source. New high-level APIs accept a
   connector name or instance and never accept raw keys in request options.
2. Runtime native-tool validation is model- and adapter-gated. Unsupported
   tools fail before a provider call rather than silently falling back.
3. Provider-owned continuation blocks use `ContentType.PROVIDER_STATE`. They
   are retained for replay but excluded from user-visible text and compaction
   summaries.
4. Access-controlled models are represented in the registry even when a caller
   cannot invoke them. `availability` communicates that distinction.
5. Unknown limits and prices are `null`/omitted. The registry does not turn
   absent vendor data into synthetic zeroes or guessed values.
6. Google computer use and all consequential local actions remain host-owned;
   provider tool events are telemetry, not authorization.

## API migration notes

- Check `agent.getAdvancedCapabilities(model)` before exposing a native tool or
  Responses extension in a product UI.
- Use `response.continuation_token` and pass it back as `continuationToken` for
  Gemini Interactions continuation.
- Use `runDirect()`/`streamDirect()` when the host owns OpenAI async-tool or
  Gemini computer-use continuations.
- Claude 5.5 applications should set explicit `thinking.mode` only when they
  need `between_tools`; ordinary adaptive mode is the safe default.
- xAI callers can request `{ capability: 'x_search' }` only through a Grok
  connector/model. The OpenAI adapter rejects it.
- Registry aliases must be globally unambiguous within each registry; a
  canonical model ID can no longer also be claimed as another model's alias.
- Media callers should continue using `ImageGeneration`, `TextToSpeech`, and
  `SpeechToText`; new media records are selected through their registries.

## Validation

The implementation is covered by registry completeness/capability tests,
provider request/response and streaming tests, connector-first wrapper tests,
runtime reasoning-map tests, TypeScript, ESLint, examples compilation, package
build/export verification, and generated API documentation. Live API access is
organization-, region-, and credential-dependent and is intentionally separate
from deterministic unit validation.

## Official sources

- OpenAI: [latest model](https://developers.openai.com/api/docs/guides/latest-model),
  [models](https://developers.openai.com/api/docs/models),
  [pricing](https://developers.openai.com/api/docs/pricing),
  [changelog](https://developers.openai.com/api/docs/changelog),
  [async tool calling](https://developers.openai.com/api/docs/guides/async-tool-calling),
  [steering](https://developers.openai.com/api/docs/guides/steering), and
  [reasoning](https://developers.openai.com/api/docs/guides/reasoning).
- Anthropic: [model overview](https://platform.claude.com/docs/en/about-claude/models/overview),
  [Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview),
  [Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview),
  [tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview),
  and [pricing](https://platform.claude.com/docs/en/about-claude/pricing).
- Google: [models](https://ai.google.dev/gemini-api/docs/models),
  [Interactions](https://ai.google.dev/gemini-api/docs/interactions),
  [Live](https://ai.google.dev/gemini-api/docs/live),
  [computer use](https://ai.google.dev/gemini-api/docs/computer-use),
  [file search](https://ai.google.dev/gemini-api/docs/file-search), and
  [pricing](https://ai.google.dev/gemini-api/docs/pricing).
- xAI: [models](https://docs.x.ai/developers/models),
  [Grok 4.7](https://docs.x.ai/developers/grok-4-7),
  [tools](https://docs.x.ai/developers/tools/overview),
  [pricing](https://docs.x.ai/developers/pricing), and
  [release notes](https://docs.x.ai/developers/release-notes).
