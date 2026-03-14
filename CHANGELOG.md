# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Async (Non-Blocking) Tool Execution** — Tools with `blocking: false` now execute in the background while the agentic loop continues. The LLM receives an immediate placeholder result, and when the real result arrives, it is delivered as a new user message. Supports auto-continuation (re-enters the agentic loop automatically) or manual continuation via `agent.continueWithAsyncResults()`. Configurable via `asyncTools: { autoContinue, batchWindowMs, asyncTimeout }` on `AgentConfig`. Includes 5 new events (`async:tool:started`, `async:tool:complete`, `async:tool:error`, `async:tool:timeout`, `async:continuation:start`), public accessors (`hasPendingAsyncTools()`, `getPendingAsyncTools()`, `cancelAsyncTool()`, `cancelAllAsyncTools()`), and `pendingAsyncTools` on `AgentResponse`. New exported types: `AsyncToolConfig`, `PendingAsyncTool`, `PendingAsyncToolStatus`.

### Fixed

- **Stream: `_buildToolCallsFromMap()` hardcoded `blocking: true`** — Tool calls built from streaming responses now correctly read the `blocking` field from tool definitions instead of always setting `blocking: true`.

- **OpenAI stream converter memory leak** — `OpenAIResponsesStreamConverter` stored all tracking state (activeItems, toolCallBuffers, reasoningBuffers) as local variables inside `convertStream()`, never cleaned up on error. Moved to instance properties with `clear()`/`reset()`/`hasToolCalls()` methods and try/finally cleanup. `OpenAITextProvider.streamGenerate()` now calls `streamConverter.clear()` in finally block.

- **MCPClient reconnect timer leak** — `connect()` catch block called `stopHealthCheck()` but not `stopReconnect()`, leaving stale reconnect timers from previous attempts.

- **BaseTextProvider: no IDisposable, no destroyed guard** — Now formally implements `IDisposable` with `isDestroyed` flag. `ensureObservabilityInitialized()` short-circuits if destroyed. Added base `mapError()` method for common HTTP error classification (401->auth, 429->rate limit, 500+->provider).

- **Bash tool: excessive background process retention** — Completed background processes were retained for 5 minutes. Reduced TTL to 60 seconds and added `MAX_COMPLETED_PROCESSES` cap (50) with oldest-first eviction.

- **HookManager: missing IDisposable interface** — Now implements `IDisposable` with proper `isDestroyed` flag and idempotent `destroy()`.

- **FileContextStorage: index corruption on concurrent writes** — `updateIndex()` and `removeFromIndex()` had no serialization, allowing concurrent read-modify-write corruption. Added async mutex (`withIndexLock()`) wrapping all index mutations.

- **CircuitBreaker: `closed` event emitted `successCount: 0`** — `transitionTo('closed')` reset `consecutiveSuccesses` to 0 before emitting the event. Now captures the value before reset.

- **GenericOpenAIProvider: silent error swallow in `listModels()`** — Now logs caught errors at debug level instead of silently discarding.

- **ToolPermissionManager: no destroy method** — Added `destroy()` that clears all internal state and calls `removeAllListeners()`.

- **MCP subscribe/unsubscribe: `{} as any` type casts** — Replaced with proper `EmptyResultSchema` from MCP SDK.

### Changed

- **All providers: `console.log` replaced with `this.logger`** — OpenAI, Anthropic, and Google text providers now use the structured logger from `BaseTextProvider` instead of `console.log`/`console.error` for API call logging.

- **OpenAITextProvider: typed params** — Request `params` changed from `any` to `Record<string, unknown>` in both `generate()` and `streamGenerate()`.

- **webFetch.ts: proper error typing** — Outer catch changed from `catch (error: any)` to `catch (error: unknown)` with proper narrowing.

- **Response.ts: documented status union** — Added JSDoc documenting all 6 status values and their use cases (`queued` for async video, `in_progress` for streaming).

### Refactored

- **Filesystem tools: shared `walkDirectory()` async generator** — Extracted common recursive directory traversal from `glob.ts` and `grep.ts` into `walkDirectory()` in `types.ts`. Both tools now use the shared generator, eliminating ~60 lines of duplicated traversal logic.

- **MCPClient: `createMCPError()` helper** — Extracted repeated `new MCPError('Failed to X from server Y', name, cause)` pattern into a private helper, reducing boilerplate across 8 call sites.

## [0.4.8] - 2026-03-12

### Fixed

- **Agent: ToolManager listener leak** — `tool:registered` event listener on ToolManager was never removed during `Agent.destroy()`. Now stores listener reference and removes it on cleanup, preventing accumulation across agent creation/destruction cycles.

- **HookManager: No destroy method** — `HookManager` had no `destroy()` method, leaving internal `hooks`, `hookErrorCounts`, and `disabledHooks` maps alive after agent destruction. Added `destroy()` that clears all internal state.

- **CircuitBreaker: Unbounded failures array** — `failures` array could grow indefinitely within the time window under high error rates. Now capped at `max(failureThreshold * 2, 20)` after pruning.

- **Bash tool: Background process memory leak** — Background processes had no limit on concurrent count or output buffer size. Added `MAX_BACKGROUND_PROCESSES` (20) and `MAX_OUTPUT_LINES` (1000) caps.

- **RateLimiter: Unbounded wait queue** — `waitQueue` had no size limit, allowing thousands of queued promises under heavy load. Added `maxQueueSize` config (default: 500) that rejects with `RateLimitError` when exceeded.

- **StorageRegistry: No per-entry removal** — Added `StorageRegistry.remove(key)` method for cleaning up individual storage backends without resetting the entire registry.

- **BrowserService: Event listener leak on destroy** — 9+ event listeners on `webContents` were never removed in `destroyBrowser()`. Now calls `webContents.removeAllListeners()` before `close()`.

- **BaseAgent: Auto-save after destroy** — Auto-save interval callback could execute after agent destruction. Added `_isDestroyed` guard to skip saves on destroyed agents.

- **webFetch: AbortController timeout leak** — `clearTimeout` was only called on the success path. Moved to `finally` block to ensure cleanup on all error paths.

## [0.4.7] - 2026-03-10

### Added

- **Streaming TTS interface** — New `IStreamingTextToSpeechProvider` interface with `supportsStreaming()` and `synthesizeStream()` methods. Providers can opt in to chunked audio delivery. Exported `TTSStreamChunk` type.

- **OpenAI TTS streaming** — `OpenAITTSProvider` implements `IStreamingTextToSpeechProvider`. Iterates the response body stream, yielding PCM/WAV/MP3 chunks as they arrive from the API.

- **TextToSpeech streaming API** — `TextToSpeech.supportsStreaming(format?)` and `synthesizeStream(text, options?)` with automatic fallback to buffered `synthesize()` for non-streaming providers.

- **VoiceStream streaming mode** — New `streaming` config flag on `VoiceStreamConfig`. When enabled, `executeTTS()` uses `synthesizeStream()` and accumulates small API chunks into ~125ms buffers before emitting `AudioChunkReadyEvent`s with `sub_index` for sub-chunk ordering.

- **StreamEvent sub_index** — `AudioChunkReadyEvent` now has optional `sub_index` field for streaming TTS sub-chunk ordering within a text chunk.

## [0.4.6] - 2026-03-04

### Added

- **V25 & Hosea: Tool Catalog adoption** — Both apps now support `ToolCatalogPluginNextGen` features. V25 `V25ContextSettings.features` uses `ContextFeatures` from core (no type duplication). V25 `buildContextConfig()` wires `pinnedCategories` and `toolCategoryScope`. Hosea adds 3 flat fields (`toolCatalogEnabled`, `pinnedCategories`, `toolCategoryScope`) to `StoredAgentConfig`, persistence mapping, `createInstance()` context config, and `AgentEditorPage` form data. All fields default to `false`/`[]` for backward compatibility.

- **Model Registry: 10 new OpenAI models** — Added GPT-5.3 (codex, chat-latest), GPT-5.2 (codex, chat-latest), GPT-5.1 (base, codex, codex-max, codex-mini, chat-latest), and GPT-5 chat-latest. OpenAI total: 12 → 22 models.

- **Model Registry: 3 new Anthropic models** — Added Claude Opus 4.6 (`claude-opus-4-6`, 128K output, adaptive thinking), Claude Sonnet 4.6 (`claude-sonnet-4-6`, 1M context beta), and Claude Opus 4 (`claude-opus-4-20250514`). Anthropic total: 7 → 10 models. Registry total: 35 → 48.

- **Model Registry: `preferred` field on `ILLMDescription`** — New optional boolean field to mark recommended models per vendor. Currently set on `gpt-5.2` (general purpose) and `gpt-5.2-codex` (coding/agentic).

- **Model Registry: Cached input pricing** — Added `cpmCached` for GPT-5.2, GPT-5, GPT-5-mini, GPT-5-nano, GPT-4.1 series, GPT-4o series, o3-mini, and o1.

- **Model Registry: Reference doc** — Created `src/domain/entities/MODEL_REGISTRY_SOURCES.md` with vendor doc URLs and update checklist.

### Changed

- **Model Registry: Fixed knowledge cutoffs** — GPT-4.1 series: 2025-04-01 → 2024-06-01. GPT-4o/4o-mini: 2024-04-01 → 2023-10-01. o3-mini/o1: 2024-10-01 → 2023-10-01.

- **Model Registry: Fixed model features** — `gpt-5.2-pro`: structuredOutput → false. `gpt-4o`/`gpt-4o-mini`: audio → false, removed audio from input/output. `o3-mini`: vision → false, removed image from input.

- **Model Registry: Anthropic deprecation notices** — Marked `claude-3-7-sonnet-20250219` as deprecated per official docs. Marked `claude-3-haiku-20240307` as deprecated (retiring April 19, 2026). Updated legacy model descriptions.

- **Model Registry: 3 new Google models** — Added `gemini-3.1-pro-preview` ($2/$12, replaces deprecated 3-pro), `gemini-3.1-flash-lite-preview` ($0.25/$1.50), and `gemini-3.1-flash-image-preview` (131K ctx, image gen up to 4K). Google total: 7 → 10. Registry total: 35 → 51.

- **Model Registry: Google pricing updates** — `gemini-3-flash-preview`: $0.15→$0.50 input, $0.6→$3.00 output. `gemini-2.5-flash`: $0.15→$0.30 input, $0.6→$2.50 output. `gemini-2.5-flash-lite`: $0.075→$0.10 input, $0.3→$0.40 output. Added cached pricing to gemini-3.1-pro, gemini-3-flash, gemini-2.5-pro, gemini-2.5-flash.

- **Model Registry: Google fixes per official docs** — Fixed context windows to exact 1,048,576 tokens. Fixed `gemini-3-pro-image-preview`: context 1M→65K, output 65K→32K, no caching. Fixed `gemini-2.5-flash-image`: context 1M→65K, output 65K→32K, reasoning→false, cutoff→June 2025. Fixed knowledge cutoffs for Gemini 3 series (2025-08→2025-01). Marked `gemini-3-pro-preview` as deprecated (shutting down March 9, 2026).

- **Model Registry: Grok fixes per official docs** — Fixed `grok-4-fast-reasoning`: added vision/image support. Fixed `grok-4-0709`: reasoning → true. Fixed `grok-3-mini`: reasoning → true. Added `cpmCached` to all 9 Grok models. Set `promptCaching: true` and `batchAPI: true` for all Grok models. Marked `grok-2-vision-1212` as legacy (not in current xAI docs).

- **Image Registry: 3 new Google Nano Banana models** — Added `gemini-3.1-flash-image-preview` (Nano Banana 2, 4K support, $0.045-$0.151/image by resolution), `gemini-3-pro-image-preview` (Nano Banana Pro, reasoning-driven design, $0.134-$0.24/image), `gemini-2.5-flash-image` (Nano Banana, fast workflows, $0.039/image). Google image models: 3 → 6.

- **Image Registry: Imagen 4 Ultra pricing fix** — `imagen-4.0-ultra-generate-001`: $0.08 → $0.06 per image per official pricing.

- **Video Registry: Google Veo pricing overhaul** — `veo-2.0-generate-001`: $0.03 → $0.35/s. `veo-3.1-fast-generate-preview`: $0.75 → $0.15/s (720p/1080p). `veo-3.1-generate-preview`: $0.75 → $0.40/s (720p/1080p). Fixed Veo 2 capabilities (no imageToVideo, 720p only). Fixed Veo 3.1 Fast capabilities (added 1080p/4K, videoExtension, frameControl).

- **TTS Registry: Google TTS pricing** — Added token-based pricing for `gemini-2.5-flash-preview-tts` ($0.50/$10.00 per 1M tokens in/out) and `gemini-2.5-pro-preview-tts` ($1.00/$20.00 per 1M tokens). Updated `TTSModelPricing` interface with `perMInputTokens`/`perMOutputTokens` fields. Updated `calculateTTSCost()` to handle both character-based (OpenAI) and token-based (Google) pricing.

- **Tool Catalog: Pinned categories** — New `pinned` config option for categories that are always loaded and cannot be unloaded by the LLM. Pinned categories are auto-loaded on plugin init, excluded from `maxLoadedCategories` limit, and skipped during compaction.

- **Tool Catalog: Dynamic instructions** — `getInstructions()` now builds instructions dynamically, listing all available categories with `[PINNED]` markers. LLM sees exactly which categories it can browse, instead of generic instructions. Core plugin tools (memory, context, etc.) are noted as always available.

### Changed

- **Tool Catalog: Separated built-in and connector scoping** — `toolCategories` now only scopes built-in categories (filesystem, web, code, etc.). Connector categories (`connector:*`) are scoped solely by `identities`, removing the previous double-filtering behavior. This is a minor behavioral change: connector categories no longer need to be listed in `toolCategories` to be visible.

- **Tool Catalog: Search results include pinned info** — `tool_catalog_search` results now include a `pinned` boolean field for each category. `getContent()` shows `[PINNED]` markers alongside `[LOADED]`.

## [0.4.5] - 2026-02-26

### Changed

- **Hosea: Migrated UnifiedToolCatalog to ToolCatalogRegistry** — Replaced Hosea's parallel tool catalog system (`UnifiedToolCatalog` + 3 provider classes) with the core `ToolCatalogRegistry`. Browser and desktop tool categories are now registered at startup via `registerHoseaTools()`. Deleted `UnifiedToolCatalog.ts`, `OneRingToolProvider.ts`, `BrowserToolProvider.ts`, `DesktopToolProvider.ts`.

- **ToolCatalogRegistry: Factory support + grouped resolution** — Extended `CatalogToolEntry` with optional fields for app-level extensions:
  - `createTool?: (ctx) => ToolFunction` — factory for runtime tool creation (e.g., browser tools needing BrowserService)
  - `source?`, `connectorName?`, `serviceType?`, `connectorServiceTypes?` — metadata fields for UI and resolution
  - `tool` field is now optional (factory-only entries supported)
  - New `resolveToolsGrouped()` method splits tools into `plain` vs `byConnector` groups
  - `resolveTools()` now accepts optional `context` for factory resolution

## [0.4.4] - 2026-02-26

### Changed

- **Tool Catalog: Hardened ToolCatalogRegistry + ToolCatalogPluginNextGen** — Major internal refactor with no breaking API changes:
  - **DRY:** Extracted `ToolRegistryEntry` type, `toDisplayName()`, and `parseConnectorCategory()` static helpers to eliminate duplication across registry and plugin
  - **Lazy ConnectorTools accessor:** Single `getConnectorToolsModule()` with false sentinel prevents retrying failed `require()` — replaces 4 separate try/catch blocks
  - **Connector logic moved to Registry:** New `discoverConnectorCategories()` and `resolveConnectorCategoryTools()` methods on `ToolCatalogRegistry` — plugin delegates instead of duplicating ~100 lines of connector discovery
  - **Bug fix:** `executeLoad()` now applies scope check uniformly to connector categories (previously skipped, allowing blocked connectors to load)
  - **Input validation:** `registerCategory()` and `registerTools()` throw on empty/whitespace category names
  - **Robust restoreState():** Validates state shape, skips non-string entries, checks `executeLoad()` error results
  - **Destroyed-state guard:** All 3 metatools return `{ error: 'Plugin destroyed' }` after `destroy()`
  - **Performance:** Connector categories discovered once at init (no more per-turn `discoverAll()` calls); tool definition token estimates cached via `WeakMap`
  - New exported types: `ConnectorCategoryInfo`, `CatalogRegistryEntry`

### Added

- **Tool Catalog: Dynamic Tool Loading/Unloading** — New `ToolCatalogRegistry` static class for registering tool categories and tools at the library level. New `ToolCatalogPluginNextGen` plugin with 3 metatools (`tool_catalog_search`, `tool_catalog_load`, `tool_catalog_unload`) that let agents dynamically discover and load only the tool categories they need at runtime. Reduces token waste when agents have 100+ available tools. Features:
  - Runtime-extensible tool category registry (library users register their own categories)
  - Agent-level category scoping via `toolCategories` config (allowlist/blocklist)
  - `ToolCatalogRegistry.resolveTools()` for resolving tool names to `ToolFunction[]` (replaces V25's parallel catalog)
  - `ToolCatalogRegistry.initializeFromRegistry()` for explicit initialization in ESM environments
  - `ToolManager.getByCategory()` convenience method for bulk category queries
  - All 3 catalog metatools added to DEFAULT_ALLOWLIST (safe by default)
  - Enable via `features: { toolCatalog: true }` on `AgentContextNextGen`
- **Routine Execution Recording** — New `RoutineExecutionRecord` types and `createExecutionRecorder()` factory for persisting routine execution history. Storage-agnostic types (`RoutineExecutionStep`, `RoutineTaskSnapshot`, `RoutineTaskResult`) replace manual hook wiring with a single factory call. `IRoutineExecutionStorage` interface for custom backends (MongoDB, PostgreSQL, etc.). Integrated into `StorageRegistry` as `routineExecutions`. Consumers wire recording with ~5 lines instead of ~140 lines of manual hooks/callbacks.
- **Routine Scheduling** — New `IScheduler` interface with `ScheduleSpec` supporting interval, one-time (timestamp), and cron schedule types. Built-in `SimpleScheduler` implementation using `setInterval`/`setTimeout` (throws clear error for cron — use a cron-capable implementation). Implements `IDisposable` for clean timer cleanup.
- **Event Trigger System** — New `EventEmitterTrigger` class for triggering routine execution from external events (webhooks, queues, custom signals). Simple typed event emitter with `on()`/`emit()`/`destroy()`. No heavy `ITriggerSource` interface — users call `emit()` from their handler.
- **Flexible Source Resolution for Routine Control Flow** — Three-layer source resolution for `map`/`fold` control flow operations. Replaces brittle `sourceKey: string` with flexible `source: ControlFlowSource` that supports:
  - **Simple key** (`source: 'items'`) — backward-compatible direct memory key lookup
  - **Task reference** (`source: { task: 'Research' }`) — resolves to `__task_output_{name}` with dep_result fallback
  - **Structured ref** (`source: { key: 'data', path: 'items' }`) — direct key with JSON path extraction
  - **Output contracts** (Layer 1) — system auto-injects storage instructions into task prompts when downstream tasks reference the current task via `source.task`, keeping user task descriptions natural language
  - **Smart coercion** (Layer 2) — algorithmic array coercion: JSON string parsing, common field extraction (`data`, `items`, `results`, etc.)
  - **LLM extraction fallback** (Layer 3) — uses `runDirect()` to extract arrays from unstructured data as a last resort
  - Template resolution extended to `source.task` and `source.key` fields
  - New exports: `TaskSourceRef`, `ControlFlowSource` types; `resolveFlowSource` function
- **Agent-Scoped Connector Availability** — Agents with `connectors: ['github', 'serper']` now only see and can execute tools produced by those connectors. New `ToolManager.registerConnectorTools(connectorName, tools)` sets `source: 'connector:<name>'` on each tool. `BaseAgent.getEnabledToolDefinitions()` filters connector tools against the agent's allowlist. Execution-time safety net in `ToolManager.execute()` blocks tools from unavailable connectors. Built-in tools (filesystem, shell, memory, etc.) are never filtered. Backward compatible: `connectors: undefined` shows all tools as before. Hosea updated to use `resolveToolsGrouped()` and `registerConnectorTools()` for proper source tracking.
- **Hosea: Routines** — Full routine/workflow support in Hosea. Routines are multi-step automated task sequences that run on a chat tab's agent instance. Includes:
  - **Routines Page** — List all routines with search, sort (name/date), and card/list view toggle. Duplicate and delete routines directly from the list.
  - **Routine Builder** — Visual editor for creating/editing routine definitions. Sections: basic info (name, description, version, author, tags), LLM instructions, task list with accordion editor (name, description, dependencies as clickable badges, suggested tools, expected output, max attempts, optional validation with completion criteria and min score), and settings (concurrency mode, dynamic tasks toggle, required tools/plugins).
  - **Routines Sidebar Panel** — Third tab in the chat sidebar. Three views: routine list (compact, clickable), routine detail (full info with Execute button), and execution monitor (live progress bar, task status cards with icons, timestamped step log, cancel button).
  - **Real-time Execution** — Routine execution state flows via StreamChunk events (`routine:started`, `routine:task_started`, `routine:task_completed`, `routine:task_failed`, `routine:step`, `routine:completed`, `routine:failed`). No persistence — execution state is in-memory only, derived from events.
  - **Chat Input Guard** — Chat input and send button are disabled while a routine is executing on the tab's agent. Placeholder text changes to "Agent is executing a routine...".
  - **Navigation** — Routines added to main sidebar under "Main" section. New `routines` and `routine-builder` page IDs.
  - Uses core library types directly (`RoutineDefinition`, `RoutineDefinitionInput`, `TaskInput`, etc.) — no duplicate `*ForUI` types.

## [0.4.3] - 2026-02-25

### Fixed

- **Routine Runner: Iteration limiter hook leak** — The per-task `pause:check` hook was only unregistered on the happy path. If a task failed via control flow error, max-attempts break, or fail-fast, the hook leaked and accumulated on reused agents. Now wrapped in `try-finally` for guaranteed cleanup.
- **Routine Runner: Fold accumulator treats empty string as valid** — Empty string `''` was incorrectly treated as "no output", falling back to ICM. Now only `null` (meaning no completed task) triggers ICM fallback. Any other value (including `''`, `0`, `false`) is a valid accumulator.

### Changed

- **Routine Runner: Permanent errors skip retry** — New `isTransientError()` classification. Auth errors, context length errors, config errors, and model-not-found errors now immediately fail the task instead of retrying uselessly. Unknown errors still retry (safer default).
- **Routine Runner: DRY refactoring** — Extracted shared `getPlugins()` helper (exported from `routineControlFlow.ts`), unified `cleanupMemoryKeys()` helper with configurable prefix lists, and `ROUTINE_KEYS` constants object replacing ~25 magic string literals across both files.
- **Routine Runner: Cleanup errors now logged** — Previously silent `catch {}` blocks in the finally cleanup now log at debug level for observability. `agent.destroy()` failures also logged.

### Added

- **Control Flow: Per-iteration timeout** — New optional `iterationTimeoutMs` field on `TaskMapFlow`, `TaskFoldFlow`, and `TaskUntilFlow`. When set, each sub-execution is wrapped with `Promise.race` timeout, preventing infinite hangs in control flow loops.
- **`ROUTINE_KEYS` constant** — Exported from core library. Contains all well-known ICM/WM key names used by the routine framework (`__routine_plan`, `__map_item`, `__fold_accumulator`, etc.).

## [0.4.2] - 2026-02-22

### Added

- **Shared Context Display Panel (`@everworker/react-ui`)** — Extracted `ContextDisplayPanel` from both v25 (750 lines) and Hosea (202 lines) into a shared `packages/react-ui/src/context-display/` module. Includes all v25 features (collapse/expand, maximize, drag-and-drop reordering with localStorage persistence, inline markdown editing, PDF/DOCX export via callbacks, highlight/scroll on change detection) plus Hosea's pin/unpin feature. App-specific logic delegated via callback props (`onSaveEntry`, `onExport`, `onPinToggle`). Feature toggles (`enableDragAndDrop`, `enableEditing`, `enableExport`) let each app opt in/out. Extracted hooks: `useDynamicUIChangeDetection` (change detection), `useOrderPersistence` (drag-and-drop order). BEM CSS with `cdp-` prefix and `--rui-*` / `--cdp-*` CSS custom properties for theming. Both Hosea and v25 migrated to thin wrappers (~45 and ~80 lines respectively). New CSS export: `@everworker/react-ui/styles/context-display`.
- **Shared Chat UI Components (`@everworker/react-ui`)** — Consolidated all reusable chat UI components into the shared `@everworker/react-ui` package. New `markdown/` module: `MarkdownRenderer` (merged from Hosea streaming context + v25 advanced math preprocessing), `CodeBlock` (streaming-aware with lazy-loaded special renderers), `MermaidDiagram`, `VegaChart`, `MarkmapRenderer` (all with optional peer deps via dynamic import), `RenderErrorBoundary`. New `chat/` module: `MessageList` (with smart auto-scroll, thinking support), `StreamingText` (animated cursor), `ToolCallCard` (category colors + expandable details), `InlineToolCall`, `ExecutionProgress` (cycling status messages + tool accordion), `ChatControls` (pause/resume/cancel), `ExportMessage` (injectable export handler), `ThinkingBlock` (NEW — collapsible thinking/reasoning display). Framework-agnostic CSS with `--rui-*` custom properties for theming. New CSS exports: `@everworker/react-ui/styles/markdown`, `@everworker/react-ui/styles/chat`, `@everworker/react-ui/styles/thinking`. Shared types: `IChatMessage`, `IToolCallInfo` with full TypeScript support.
- **Generic Thinking/Reasoning Support** — Vendor-agnostic thinking/reasoning support across all three providers (Anthropic, OpenAI, Google). New `thinking` option on `TextGenerateOptions`: `{ enabled: boolean, budgetTokens?: number, effort?: 'low'|'medium'|'high' }`. Adds `ThinkingContent` type with vendor-aware persistence (`persistInHistory: true` for Anthropic, `false` for OpenAI/Google). Anthropic thinking blocks round-trip with signature preservation. OpenAI reasoning summaries extracted as `ThinkingContent`. Google thought parts detected and converted. New streaming events: `REASONING_DELTA` and `REASONING_DONE` with type guards `isReasoningDelta()` / `isReasoningDone()`. `StreamState` gains reasoning buffers. `StreamHelpers` adds `thinkingOnly()`, `textAndThinking()`, `accumulateThinking()`. `AgentContextNextGen` exposes `lastThinking` property (always available regardless of persistence). Agent-level: `thinking` config option wires through to all providers. `LLMResponse` gains `thinking?: string` convenience field (parallel to `output_text`). OpenAI `reasoning_tokens` now captured in `TokenUsage.output_tokens_details`. Shared `validateThinkingConfig()` validates budget/effort before sending to providers.
- **Snapshot API (`getSnapshot()` / `getViewContext()`)** — New methods on `AgentContextNextGen` and `BaseAgent` that return fully serializable, canonical representations of context state. `getSnapshot()` returns `IContextSnapshot` with budget, plugins (auto-discovered), tools, and conversation stats. `getViewContext()` returns `IViewContextData` with a human-readable breakdown of the prepared context (for "View Full Context" UIs). Plugin data is an array (not hardcoded fields) — new/custom plugins appear automatically without code changes. New types: `IContextSnapshot`, `IPluginSnapshot`, `IToolSnapshot`, `IViewContextData`, `IViewContextComponent`. New utility: `formatPluginDisplayName()`.
- **Shared React UI package (`@everworker/react-ui`)** — New `packages/react-ui/` package with reusable "Look Inside" components for displaying agent context internals. Includes: `LookInsidePanel` (main container with auto-discovery of plugin sections), `ViewContextContent` (prepared context breakdown), `CollapsibleSection`, and individual sections (ContextWindow, TokenBreakdown, SystemPrompt, Tools). Plugin renderers for WorkingMemory, InContextMemory, PersistentInstructions, and UserInfo with a registry for custom renderers (`registerPluginRenderer()`). No icon/CSS framework dependency — uses semantic `look-inside-*` CSS classes with CSS custom properties for theming.
- **Hosea: LLM Providers page improvements** — (1) "Update Key" button now works: opens edit modal to change API key or base URL for local connectors. (2) Ollama vendor added: no API key required, optional base URL field (defaults to `http://localhost:11434/v1`). (3) "Fetch Models" button in both Add and Edit modals: queries the provider's API via `listModels()` to discover available models, displayed as badges. (4) Models shown on all connector cards (not just Everworker connectors). (5) `addConnector()` now registers with the Connector library immediately (fixes bug where newly added connectors weren't usable until restart).
- **Hosea: Agent editor model dropdown shows live models** — The model selector in the Agent Editor now fetches live models from the provider's API via `listModels()`. Models are shown in two groups: "Known Models" (from the static registry, with context window info) and "Available from Provider" (live models not in the registry). This is essential for Ollama and other providers where the available models depend on what's installed locally.
- **`listModels()` on all LLM text providers** — New `listModels(): Promise<string[]>` method on `ITextProvider` (now required), implemented on OpenAI, Anthropic, Google, Vertex AI, and Generic OpenAI providers. Returns sorted model ID strings from the provider's API. `GenericOpenAIProvider` wraps in try/catch for safety (some OpenAI-compatible APIs may not support `/v1/models`). `BaseTextProvider` default returns `[]`. Also exposed as `agent.listModels()` on all agents via `BaseAgent`.
- **Ollama Integration Tests** — New dedicated Ollama integration test file (`tests/integration/text/Ollama.integration.test.ts`) covering basic text generation, streaming, tool calling (single, sequential, counter), multi-turn conversation, and `runDirect`. Tests auto-detect Ollama availability and model via HTTP ping to `/api/tags`. Ollama also added to `AllModels` and `ProviderConverters` integration test suites including cross-provider consistency checks.

### Fixed

- **Thinking: Vendor detection** — Streaming thinking persistence now uses `connector.vendor` instead of fragile response ID prefix parsing. Previously, `responseId.startsWith('msg_')` was used to detect Anthropic, which could collide with OpenAI message IDs.
- **Thinking: `StreamHelpers.collectResponse()` now includes thinking** — `reconstructLLMResponse()` was silently dropping all accumulated reasoning content. Now correctly includes `ThinkingContent` in the output and populates the `thinking` convenience field.
- **Thinking: `lastThinking` reset** — `lastThinking` is now reset to `null` at the start of each `prepare()` call, preventing stale thinking data from leaking across turns in error paths.
- **Thinking: Anthropic signature round-trip safety** — Streaming thinking blocks (which lack Anthropic's opaque signature) are now skipped when converting back to Anthropic format, preventing API errors. Non-streaming responses correctly preserve and round-trip signatures.
- **Thinking: OpenAI duplicate content removed** — OpenAI reasoning items no longer produce both a legacy `reasoning` item and a `ThinkingContent` item. Only the unified `ThinkingContent` is emitted.
- **Snapshot serialization** — `getSnapshot()` now ensures plugin `contents` are always JSON-serializable. `Map` values (returned by InContextMemory, PersistentInstructions, UserInfo plugins) are converted to arrays. `Promise` values (returned by WorkingMemory) are awaited. This fixes data loss when snapshots are transmitted over JSON-based transports (e.g., Meteor DDP).
- **AlgorithmicCompactionStrategy graceful degradation** — The `algorithmic` compaction strategy (the default) no longer throws when `workingMemory: false`. Previously, creating an agent with `features: { workingMemory: false }` would crash because the strategy requires the `working_memory` plugin. Now the strategy degrades gracefully: when working memory is unavailable, it skips moving large tool results to memory and only applies tool pair limiting + rolling window compaction. The `validateStrategyDependencies` check in `AgentContextNextGen` now logs a warning instead of throwing.

### Changed

- **Hosea: Migrated chat rendering to shared `@everworker/react-ui`** — Replaced ~300 lines of inline message rendering (renderUserMessage/renderAssistantMessage/renderSystemMessage/renderMessage, ToolCallDisplay imports) with shared `MessageList` and `ExecutionProgress` components. `Message` and `ToolCallInfo` types now re-exported from `@everworker/react-ui` (`IChatMessage`, `IToolCallInfo`). Added `streamingThinking` support to `TabState` and chunk handling. Added thinking stream events (`thinking`, `thinking_done`) to `StreamChunk` union type and `AgentService` stream handler (maps `response.reasoning.delta`/`response.reasoning.done`). New CSS imports: `@everworker/react-ui/styles/markdown`, `@everworker/react-ui/styles/chat`, `@everworker/react-ui/styles/thinking`. ContextDisplayPanel now uses shared `MarkdownRenderer`.
- **v25: Migrated chat components to shared `@everworker/react-ui`** — `MessageList` replaced with thin adapter wrapper that converts v25 `IChatMessage` (with `_id`, `timestamp: Date`) to shared format via `adaptMessage()`. `ToolCallCard` replaced with adapter that maps v25 field names (`toolCallId`→`id`, `toolName`→`name`, `arguments`→`args`, `completed`→`complete`). `MarkdownRenderer` replaced with re-export from shared lib (1285 lines → 11 lines). `StreamingText` updated to use shared `MarkdownRenderer`. New adapter layer: `ui/adapters/chatAdapters.ts` with `adaptToolCall()` and `adaptMessage()` functions. Added thinking/reasoning support: new `reasoning.delta`/`reasoning.done` event types in V25ChatEventType, new payload types `IV25ReasoningDeltaPayload`/`IV25ReasoningDonePayload`, `AgentEventBridge` handles reasoning stream events, `useAgentChat` tracks `streamingThinking` state, `IAgentChatState` includes `streamingThinking`, `AgentChatPage` passes thinking through to `MessageList`.
- **`@everworker/react-ui`: Fixed component issues** — Removed unused `react-bootstrap` peer dependency. Typed `CodeComponent` props properly (was `any`). Typed VegaLite dynamic component (was `React.ComponentType<any>`).
- **Hosea: Migrated Look Inside panel to shared `@everworker/react-ui`** — Replaced ~2,300 lines of monolithic rendering code (InternalsContent + InternalsPanel + manual data extraction in AgentService) with thin wrappers around the shared `LookInsidePanel` and `ViewContextContent` components. Backend now uses `agent.getSnapshot()` and `agent.getViewContext()` instead of ~490 lines of manual plugin-level data extraction. Added `@everworker/react-ui` as a dependency.
- **v25: Migrated Look Inside panel to shared `@everworker/react-ui`** — Replaced ~1,100 lines (LookInsidePanel + ViewContextModal + internalsTypes) with thin wrappers. Backend uses `agent.getSnapshot()` and `agent.getViewContext()` instead of ~230 lines of manual extraction. Deleted `internalsTypes.ts` (types now from `@everworker/oneringai`).
- **Shared `@everworker/react-ui`: Added memory entry click support** — `WorkingMemoryRenderer` now supports optional `onEntryClick`, `entryValues`, `loadingEntryKey` props for lazy value loading (used by Hosea's IPC-based memory value fetching). Props flow through `LookInsidePanel` via `onMemoryEntryClick`, `memoryEntryValues`, `loadingMemoryKey`.
- **GenericOpenAIProvider** — `validateApiKey()` now always returns valid for generic providers (Ollama, local models, etc.) that don't require authentication, preventing validation warnings for `auth: { type: 'none' }` connectors.
- **NoneConnectorAuth documentation** — Updated comments to clarify that `auth: { type: 'none' }` is for local services like Ollama, not just testing/mock providers.

## [0.4.0] - 2026-02-20

### Added

- **Microsoft Graph Connector Tools** — 6 new ConnectorTools for Microsoft Graph API, auto-registered for connectors with `serviceType: 'microsoft'` or `baseURL` matching `graph.microsoft.com`. Tools: `create_draft_email` (new draft or reply draft), `send_email` (send or reply), `create_meeting` (calendar event with optional Teams link), `edit_meeting` (partial update), `get_meeting_transcript` (Teams transcript as plain text), `find_meeting_slots` (availability-based scheduling). Supports both delegated (`/me`) and application (`/users/{id}`) permission modes via `getUserPathPrefix()` helper. All tools follow the ConnectorTools pattern — use `ConnectorTools.for('my-microsoft-connector')` to get all tools.
- **RoutineDefinition Storage** — New `IRoutineDefinitionStorage` interface and `FileRoutineDefinitionStorage` implementation for persisting routine definitions to disk. Per-user isolation via optional `userId` (defaults to `'default'`). Stored at `~/.oneringai/users/<userId>/routines/<id>.json` with index file for fast filtering. Supports tag/search filtering and pagination. Integrated into `StorageRegistry` as `routineDefinitions` factory.
- **Routine Runner** — New `executeRoutine()` function (`src/core/routineRunner.ts`) that executes a `RoutineDefinition` end-to-end. Creates an Agent with working memory + in-context memory, runs tasks in dependency order, validates completion via LLM self-reflection, and clears conversation between tasks while preserving memory plugins as the data bridge. Supports configurable prompts (system, task, validation), retry with max attempts, `fail-fast` / `continue` failure modes, and `onTaskComplete` / `onTaskFailed` callbacks. Exported as `executeRoutine`, `ExecuteRoutineOptions`, and `ValidationContext`.
- **Routine Validation Context** — Task validation now receives a full `ValidationContext` (not just the agent's text output). The validator sees: the agent's response text, the in-context memory state, the working memory index, and a formatted log of all tool calls made during the task. This allows the LLM validator to verify what actually happened (e.g., "key findings stored in memory") rather than relying on the agent's claims.
- **UserInfo Plugin** — New `UserInfoPluginNextGen` for storing user-specific preferences and context. Data is user-scoped (not agent-scoped), allowing different agents to share the same user data. Storage path: `~/.oneringai/users/<userId>/user_info.json` (defaults to `~/.oneringai/users/default/user_info.json` when no userId). Enable via `features: { userInfo: true }`. Includes 4 tools: `user_info_set`, `user_info_get`, `user_info_remove`, `user_info_clear` (all allowlisted by default). **userId is optional** — tools work without it, defaulting to the `'default'` user. User info is automatically injected into the LLM context as markdown — no need to call `user_info_get` every turn.
- **IUserInfoStorage interface** — Storage abstraction for user information with file-based implementation (`FileUserInfoStorage`). UserId is optional (`string | undefined`), defaults to `'default'`. Supports multi-user scenarios via `StorageRegistry` pattern with optional `StorageContext`.
- **userInfo feature flag** — Added to `ContextFeatures` interface. Default: `false`.
- **userInfo storage factory** — Added to `StorageConfig` interface as context-aware factory: `userInfo: (context?: StorageContext) => IUserInfoStorage`.

- **Routine Context Flow** — Routine tasks now automatically receive plan overview and dependency results before execution. Plan overview (all tasks with statuses) is injected into in-context memory as `__routine_plan`. Dependency results are automatically routed: small results (< 5000 tokens) go directly into in-context memory, large results go to working memory with descriptive labels. Tasks with dependencies get a prompt note about available results. All routine-managed keys (`__routine_*`, `__dep_result_*`) are cleaned up after execution.

### Changed

- **InContextMemory default enabled** — `DEFAULT_FEATURES.inContextMemory` changed from `false` to `true`. All agents now have in-context memory available by default.
- **InContextMemory default token limit** — `maxTotalTokens` increased from 4000 to 40000 to accommodate routine plan overviews and dependency results.
- **Custom Tools Storage - Optional Per-User Isolation** — Custom tools storage now supports optional per-user isolation for multi-tenant scenarios. `ICustomToolStorage` interface updated to accept optional `userId` parameter in all methods: `save(userId?, definition)`, `load(userId?, name)`, `delete(userId?, name)`, `exists(userId?, name)`, `list(userId?, options)`, `updateMetadata(userId?, name, metadata)`, `getPath(userId?)`. When `userId` is not provided, defaults to `'default'` user. File storage path changed from `~/.oneringai/custom-tools/` to `~/.oneringai/users/<userId>/custom-tools/` (defaults to `~/.oneringai/users/default/custom-tools/`). **Backwards compatible** - existing code works without changes. Opt-in to multi-user isolation by providing `userId: 'user-id'` when creating agents.

### Migration Guide: Custom Tools Storage

**No migration required for existing applications!** Custom tools storage is fully backwards compatible.

**For Custom Storage Implementers:**

If you have a custom `ICustomToolStorage` implementation, update methods to accept optional `userId`:

```typescript
// Before (0.3.1 and earlier)
class MyCustomToolStorage implements ICustomToolStorage {
  async save(definition: CustomToolDefinition): Promise<void> {
    await this.db.insert(definition);
  }
  async load(name: string): Promise<CustomToolDefinition | null> {
    return this.db.findOne({ name });
  }
}

// After (0.4.0+) - userId is optional
class MyCustomToolStorage implements ICustomToolStorage {
  async save(userId: string | undefined, definition: CustomToolDefinition): Promise<void> {
    const user = userId || 'default';
    await this.db.insert({ userId: user, ...definition });
  }
  async load(userId: string | undefined, name: string): Promise<CustomToolDefinition | null> {
    const user = userId || 'default';
    return this.db.findOne({ userId: user, name });
  }
}
```

**For Existing Custom Tools:**

Custom tools at `~/.oneringai/custom-tools/` will be moved automatically on first access to `~/.oneringai/users/default/custom-tools/`. No manual migration needed.

**For Multi-Tenant Applications (Optional):**

To enable per-user isolation, provide `userId` when creating agents:

```typescript
// Single-user app (no changes needed)
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  // No userId - defaults to 'default' user
});

// Multi-tenant app (opt-in)
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  userId: currentUser.id,  // Each user gets isolated custom tools
});

// OR set globally
StorageRegistry.setContext({ userId: currentUser.id });
```

## [0.3.1] - 2026-02-18

### Fixed

- **ConnectorTools invalid tool names** — Connector names with spaces or special characters (e.g., "Microsoft Graph API") now produce valid tool names (`Microsoft_Graph_API_api`) instead of invalid ones that break LLM provider APIs. Added shared `sanitizeToolName()` utility and deduplicated the existing MCP adapter sanitizer.

### Added

- **`sanitizeToolName()`** — Exported utility that sanitizes arbitrary strings to valid tool names matching `^[a-zA-Z0-9_-]+$`.

## [0.3.0] - 2026-02-18

### Fixed

- **Registry-driven model capabilities** — All 5 text providers (OpenAI, Anthropic, Google, Vertex AI, Generic) now resolve model capabilities from the centralized `MODEL_REGISTRY` instead of hardcoded string matching. Models like GPT-5.2 (400K context) now correctly report their limits instead of falling through to provider defaults (e.g., 4096 tokens). Error messages for context length exceeded now report the actual model's limit.

### Added

- **`resolveModelCapabilities()`** — New helper that maps any model identifier to `ModelCapabilities` using the centralized registry, with vendor-specific fallbacks for unregistered models.
- **`resolveMaxContextTokens()`** — New helper for accurate context limit resolution in error messages.
- **StorageRegistry** — Centralized storage backend registry (`StorageRegistry` class in `src/core/StorageRegistry.ts`). Provides a single `configure()` call to swap all storage backends (custom tools, media, sessions, persistent instructions, working memory, OAuth tokens, etc.) at init time. All subsystems resolve storage lazily at execution time via `StorageRegistry.resolve()`, with file-based defaults as fallback. No breaking changes — existing `setMediaStorage()`, `Connector.setDefaultStorage()`, and explicit constructor params continue to work.
- **StorageContext** — Multi-tenant support for `StorageRegistry`. All factory functions (`customTools`, `sessions`, `persistentInstructions`, `workingMemory`) now accept an optional opaque `StorageContext` (same pattern as `ConnectorAccessContext`). Set globally via `StorageRegistry.setContext({ userId, tenantId })` or auto-derived from `AgentContextNextGen.userId`. Enables storage partitioning by user, tenant, or any custom dimension.
- **`customTools` is now a context-aware factory** — `StorageConfig.customTools` changed from `ICustomToolStorage` to `(context?: StorageContext) => ICustomToolStorage`. Custom tool meta-tools (`custom_tool_save/list/load/delete`) receive `ToolContext` at execution time and forward `userId` to the factory for per-user storage isolation. All 6 meta-tools remain in the built-in tool registry.
- **`Agent.saveDefinition()` and `Agent.fromStorage()` now resolve from StorageRegistry** — The `storage` parameter is now optional. If omitted, resolves from `StorageRegistry.get('agentDefinitions')`.
- **`ConnectorConfigStore.create()` factory** — New static factory that resolves `IConnectorConfigStorage` from `StorageRegistry.get('connectorConfig')` when no explicit storage is provided.
- **xAI Grok models** — 9 Grok models added to the model registry: Grok 4.1 (fast reasoning/non-reasoning, 2M context), Grok 4 (fast reasoning/non-reasoning, flagship 0709), Grok Code Fast 1, Grok 3/3-mini, Grok 2 Vision.

### Changed

- **SDK Upgrades** — Updated all LLM vendor SDKs to latest versions:
  - `@anthropic-ai/sdk` 0.30.1 → 0.76.0 (eliminates 6 deprecated transitive dependencies: node-fetch, node-domexception, formdata-node, abort-controller, agentkeepalive, web-streams-polyfill)
  - `openai` 6.16.0 → 6.22.0
  - `@google/genai` 1.34.0 → 1.41.0
  - `@modelcontextprotocol/sdk` 1.25.3 → 1.26.0 (security fix)
- **Anthropic Provider** — Removed type assertion hacks for URL-based images (now officially supported in SDK)

## [0.2.3] - 2026-02-17

### Added

- **Custom Tool Generation System** *(Highlight)* — A complete meta-tool system that enables any agent to **create, test, iterate, and persist reusable custom tools at runtime**. 6 new tools in the `custom-tools` category:
  - `custom_tool_draft` — Validates name, schema, and code syntax. Dynamic description shows full sandbox API + all registered connectors
  - `custom_tool_test` — Executes code in the VM sandbox with test input. Dynamic description with sandbox API + connector list
  - `custom_tool_save` — Persists validated tool to `~/.oneringai/custom-tools/` with tags, category, and connector metadata
  - `custom_tool_list` — Searches saved tools by name, description, tags, or category with pagination
  - `custom_tool_load` — Retrieves full definition including code for inspection or modification
  - `custom_tool_delete` — Removes a tool from storage
  - `hydrateCustomTool()` — Converts a saved `CustomToolDefinition` into a live `ToolFunction` ready for `ToolManager.register()`
  - `createCustomToolMetaTools()` — Bundle factory that creates all 6 tools with shared storage
  - All 6 tools are auto-registered in the tool registry and visible in Hosea's tool catalog
- **Custom Tool Storage** — `ICustomToolStorage` domain interface with `FileCustomToolStorage` implementation. Supports CRUD, search (case-insensitive substring on name + description), tag/category filtering, and pagination. Atomic writes with `.tmp` + rename pattern and index-based listing. Pluggable — implement `ICustomToolStorage` for MongoDB, S3, or any backend.
- **ToolManager metadata fields** — `tags`, `category`, and `source` fields on `ToolOptions`, `ToolRegistration`, and `SerializedToolState`. Enables tracking tool provenance (`built-in`, `connector`, `custom`, `mcp`) and categorization. Persisted through `getState()`/`loadState()`.
- **Exported `executeInVM`** — The VM sandbox executor from `executeJavaScript.ts` is now a public export, enabling reuse by custom tool meta-tools and external code.
- **OAuth Scope Selector** — New `ScopeSelector` component replaces the plain-text scope input field with a checkbox-based selector. Shows template-defined scopes with human-readable descriptions, all pre-checked by default. Users can toggle scopes on/off and add custom scopes. Falls back to plain text input when no template scopes are available.
- **Scope descriptions for vendor templates** — Added `scopeDescriptions` field to `AuthTemplate` type. Enriched 15+ vendor templates with comprehensive scope lists and descriptions: Microsoft (21 Graph scopes), Google (9 scopes), GitHub (9 scopes), Slack (10 scopes), Discord (7 scopes), HubSpot (8 scopes), Atlassian/Jira/Confluence/Bitbucket (expanded), Salesforce (6 scopes), Shopify (10 scopes), Box (4 scopes), PagerDuty (2 scopes), Sentry (5 scopes), Dropbox (7 scopes), GitLab, Zendesk, Trello.
- **QuickBooks vendor template** — OAuth 2.0 authorization_code flow template for QuickBooks Online API (Intuit). Includes sandbox support and company/realm ID notes.
- **Ramp vendor template** — Dual OAuth flow template for Ramp financial API: client_credentials (app-level access) and authorization_code (user-level access).

### Fixed

- **OAuth public client fallback** — AuthCodePKCE flow now auto-retries token exchange and refresh without `client_secret` when the provider rejects it for public clients (e.g., Microsoft/Entra ID error AADSTS700025). Prevents failures when a `clientSecret` is configured but the app registration is set to "public client".
- **Documentation cleanup** — Fixed multiple outdated sections in README.md and USER_GUIDE.md:
  - Replaced non-existent `webSearch`/`webScrape` standalone imports with correct `ConnectorTools.for()` pattern in README
  - Added missing scrape providers (Jina Reader, Firecrawl, ScrapingBee) to README
  - Fixed Grok provider capabilities (now shows Image ✅ and Video ✅)
  - Removed non-existent "Tool Result Eviction" section from USER_GUIDE (feature doesn't exist in codebase)
  - Removed non-existent `IdempotencyCache` from Direct LLM comparison table
  - Fixed Feature-Aware APIs section referencing old AgentContext properties (`ctx.cache`, `ctx.permissions`, `requireMemory()`, etc.) to match actual AgentContextNextGen API
  - Fixed `setupInContextMemory()` references to use correct `ctx.getPlugin()` API
  - Fixed Web Tools description to correctly note web_search/web_scrape are connector-dependent

## [0.2.1] - 2026-02-11

### Added

- **Desktop Automation Tools** — 11 new `desktop_*` tools for OS-level desktop automation, enabling "computer use" agent loops (screenshot → vision model → tool calls → repeat). Tools: `desktop_screenshot`, `desktop_mouse_move`, `desktop_mouse_click`, `desktop_mouse_drag`, `desktop_mouse_scroll`, `desktop_get_cursor`, `desktop_keyboard_type`, `desktop_keyboard_key`, `desktop_get_screen_size`, `desktop_window_list`, `desktop_window_focus`. All coordinates use physical pixel space (screenshot space); the driver handles Retina/HiDPI scaling internally. Uses `@nut-tree-fork/nut-js` as an optional peer dependency. Convenience bundle: `tools.desktopTools`.

- **`__images` convention for multimodal tool results** — Tool results containing an `__images` array (e.g., from `desktop_screenshot`) are automatically converted to native multimodal content by provider converters: Anthropic (image blocks in tool_result), OpenAI (follow-up user message with input_image), Google (inlineData parts). Images are separated from text content at the context layer (`addToolResults()`), stored on a dedicated `__images` field on `ToolResultContent`, and counted as image tokens (~85-2000 depending on dimensions) rather than text tokens. This prevents large screenshots from blowing the context budget or being rejected as binary.

- **Hosea: DesktopToolProvider** — New tool provider for Hosea that exposes all desktop automation tools in the unified tool catalog under the "Desktop Automation" category.

- **Document Reader** — Universal file-to-LLM-content converter. New `DocumentReader` class reads arbitrary file formats (Office, PDF, spreadsheets, HTML, text, images) from any source (file path, URL, Buffer, Blob) and produces `DocumentPiece[]` (markdown text + base64 images) with metadata. Pluggable architecture with 6 format handlers (Office via `officeparser`, Excel via `exceljs`, PDF via `unpdf`, HTML, text, images) and a configurable transformer pipeline (header, table formatting, truncation). All heavy dependencies are lazy-loaded.

- **`read_file` auto-detects document formats** — The `read_file` tool now automatically converts binary document formats (PDF, DOCX, XLSX, PPTX, ODT, ODP, ODS, RTF, PNG, JPG, GIF, WEBP) to markdown text. No schema change — binary documents are returned as markdown in the existing `content` field. Agents can now `read_file({ file_path: "/path/to/report.pdf" })` and it just works.

- **`web_fetch` auto-detects document downloads** — The `web_fetch` tool now detects document Content-Types (application/pdf, Office MIME types) and URL extensions, automatically converting downloaded documents to markdown. Returns `contentType: 'document'` with optional `documentMetadata`.

- **`readDocumentAsContent()` bridge** — New utility function in `src/utils/documentContentBridge.ts` converts `DocumentResult` → `Content[]` for direct LLM input. Includes `documentToContent()` for conversion and `readDocumentAsContent()` as a one-call convenience. Supports image filtering, detail level, and adjacent text merging.

- **Image filtering** — Configurable image filtering removes small/junk images (logos, icons, backgrounds) from extracted documents. Filter by `minWidth`, `minHeight`, `minSizeBytes`, `maxImages`, and `excludePatterns`. Applied both at extraction time and at content conversion time.

- **New error classes** — `DocumentReadError` and `UnsupportedFormatError` in `src/domain/errors/AIErrors.ts`.

- **New constants** — `DOCUMENT_DEFAULTS` in `src/core/constants.ts` with all configurable defaults (max tokens, image filters, Excel limits, etc.).

### Changed

- **Hosea: Non-blocking startup** — The Hosea app window now appears immediately (~1-2 seconds) instead of waiting ~20 seconds for all connectors, tools, and agents to load. Heavy initialization (connector loading, tool discovery, EW profile sync, agent loading) now runs in the background after the window is visible. A "Starting HOSEA..." spinner shows while loading completes. IPC handlers that require full initialization automatically wait via `readyHandler` wrapper. Added `AgentService.createFast()` factory method and `isReady`/`whenReady()` readiness tracking API. Renderer listens for `service:ready` event before running app initialization logic.

- **`excludeExtensions` updated** — Removed `.pdf`, `.docx`, `.xlsx`, `.pptx` from the default filesystem tool exclusion list since DocumentReader now handles these formats.

- **Image token estimation** — `estimateItemTokens()` now uses `estimateImageTokens()` (tile-based model matching OpenAI pricing) instead of a hardcoded 200-token flat estimate. `ITokenEstimator` interface extended with optional `estimateImageTokens(width?, height?, detail?)` method. Both `simpleTokenEstimator` and `ApproximateTokenEstimator` implement it. `INPUT_IMAGE_URL` respects `detail` level. `TOOL_RESULT` with `__images` counted as image tokens (~1000 default) rather than text tokens on the base64 string.

### Fixed

- **`web_scrape` swallowing real API errors** — When both native fetch and external API (e.g., ZenRows) failed, the tool returned a generic "All scraping methods failed. Site may have bot protection." message, hiding the actual error details (e.g., `AUTH004: Usage exceeded`, `HTTP 402`, quota limits). Now propagates specific errors from each attempted method: `"All scraping methods failed. native: <error> | api(zenrows): ZenRows API error (402): ..."`.

- **Screenshots rejected as "binary content too large"** — Tool results with `__images` (e.g., desktop screenshots) were being counted as text tokens (~300K tokens for a 1MB base64 string), triggering the oversized input handler which replaced the entire result with a rejection message. The model never saw the image. Fixed by: (1) separating `__images` from the text content in `addToolResults()`, (2) counting images using `estimateImageTokens()` instead of text estimation, (3) preserving `__images` through emergency truncation. All three provider converters (Anthropic, OpenAI, Google) updated to read `__images` from the Content object first (with JSON-parsing fallback for backward compatibility).

- **Desktop mouse operations** — `mouse.setPosition()` in `@nut-tree-fork/nut-js` silently no-ops (reports success but doesn't move the cursor). All mouse operations now use `mouse.move(straightTo(...))` with `mouseSpeed=10000` for near-instant movement (22-49ms, ±1px precision). Mouse speed and animation delays disabled on driver initialization. `desktop_mouse_move` and `desktop_mouse_click` now return the **actual** cursor position after the operation for verification. `desktop_screenshot` description updated to warn about region coordinate offsets and now returns `regionOffsetX`/`regionOffsetY` in the result.

- **`desktop_window_focus` not working** — `focusWindow()` was matching windows by `win.processId` which doesn't exist on nut-tree Window objects (always `undefined`). Fixed to use the actual `windowHandle` property — the unique OS window identifier. `getWindowList()` now returns `windowHandle` as the `id` and caches Window objects for efficient `focusWindow()` lookup.

## [0.2.0] - 2026-02-09

**Multi-User Support** — This release introduces uniform multi-user support across the entire framework. Set `userId` once on an agent and it automatically flows to all tool executions, connector API calls (OAuth tokens), session metadata, and dynamic tool descriptions. Combined with the new `connectors` allowlist and scoped connector registry on `ToolContext`, this provides a complete foundation for building multi-user and multi-tenant AI agent systems.

### Added

- **`userId` auto-threading through Agent → Context → ToolContext** — Set `userId` once at agent creation (`Agent.create({ userId: 'user-123' })`) or at runtime (`agent.userId = 'user-456'`) and it automatically flows to all tool executions via `ToolContext.userId`. Also persisted in session metadata on save. No breaking changes — `userId` is optional everywhere.

- **`connectors` allowlist on Agent/Context** — Restrict an agent to a subset of registered connectors via `Agent.create({ connectors: ['github', 'slack'] })`. Only listed connectors appear in tool descriptions and sandbox execution. Combines with userId scoping: allowlist is applied on top of the access-policy-filtered view. Available as `agent.connectors` getter/setter at runtime. `ToolContext.connectorRegistry` now provides the resolved registry to all tools.

- **`@everworker/oneringai/shared` Subpath Export** — New lightweight subpath export containing only pure data constants and types (Vendor, MODEL_REGISTRY, SERVICE_DEFINITIONS) with zero Node.js dependencies. Safe for Cloudflare Workers, Deno, and browser environments.

### Changed

- **`execute_javascript` tool: userId-scoped connectors, improved description, configurable timeout** — The tool now auto-injects `userId` from ToolContext into all `authenticatedFetch` calls. Connector listing (both in description and sandbox) is scoped to the current user via the global access policy when set. `descriptionFactory` now receives `ToolContext` so descriptions always reflect the connectors visible to the current user. The tool description is significantly improved with better usage guidance, more examples, and shows service type/vendor for each connector. Sandbox globals expanded (URL, URLSearchParams, RegExp, Map, Set, TextEncoder, TextDecoder). Factory accepts `maxTimeout` and `defaultTimeout` options via `createExecuteJavaScriptTool({ maxTimeout: 60000 })`.

- **Consistent userId handling across all tools** — All tools now read `userId` from `ToolContext` at execution time (auto-populated by `Agent.create({ userId })`). ConnectorTools generic API tool, all 7 GitHub tools, and multimedia tools use `effectiveUserId = context?.userId ?? closureUserId` for backward compatibility. Removed unused `_userId` parameters from web search, web scrape, and speech-to-text tool factories.

- **`web_search` and `web_scrape` migrated to ConnectorTools pattern** — `webSearch` and `webScrape` are no longer built-in singleton tools. They are now ConnectorTools-registered factories (`createWebSearchTool`, `createWebScrapeTool`) that bind to a specific connector. Use `ConnectorTools.for('my-serper')` to get prefixed search tools, or call the factory directly. Search service types: `serper`, `brave-search`, `tavily`, `rapidapi-search`. Scrape service types: `zenrows`, `jina-reader`, `firecrawl`, `scrapingbee`. The legacy env-var fallback (`SERPER_API_KEY`, etc.) has been removed — all auth goes through connectors.

### Removed

- **`webFetchJS` tool and Puppeteer dependency** — Removed the `web_fetch_js` tool (`tools.webFetchJS`) and the `puppeteer` optional dependency. The `webScrape` tool's fallback chain now goes directly from native fetch to external API providers. Sites requiring JavaScript rendering should use the `web_scrape` tool with an external scraping provider (ZenRows, Jina Reader, etc.) instead.

- **`tools.webSearch` and `tools.webScrape` singleton exports** — Replaced by `createWebSearchTool(connector)` and `createWebScrapeTool(connector)` factory functions. The old env-var-based search providers (`src/tools/web/searchProviders/`) have been removed.

## [0.1.4] - 2026-02-08

### Added

- **`getVendorDefaultBaseURL(vendor)` — Runtime vendor base URL resolution** — New exported function that returns the default API base URL for any supported vendor. For OpenAI/Anthropic, reads from the actual installed SDKs at runtime (`new OpenAI({apiKey:'_'}).baseURL`), ensuring URLs auto-track SDK updates. For OpenAI-compatible vendors (Groq, Together, Grok, DeepSeek, Mistral, Perplexity, Ollama) and Google/Vertex, uses known stable endpoints. Built once at module load via `ReadonlyMap` for zero per-request overhead. Primarily used by LLM proxy servers that need vendor URLs without instantiating full provider objects.

- **Google provider proxy support** — `GoogleTextProvider` now passes `config.baseURL` to the Google GenAI SDK via `httpOptions.baseUrl`, enabling transparent HTTP proxy routing. Previously, the Google SDK always connected directly to `generativelanguage.googleapis.com` regardless of the connector's `baseURL` setting.

### Fixed

- **LLM proxy: empty `baseURL` for LLM connectors** — LLM connectors stored without `baseURL` (because provider SDKs handle defaults internally) caused proxy servers to construct relative URLs like `fetch('/v1/messages')` which silently failed. The proxy now falls back to `getVendorDefaultBaseURL(vendor)` when the connector has no `baseURL`.

- **LLM proxy: vendor-specific auth headers** — Anthropic (`x-api-key`) and Google (`x-goog-api-key`) vendor-specific auth headers now take priority over a connector's generic `headerName` (e.g. `Authorization`). Previously, connectors with `headerName: 'Authorization'` would send the API key in the wrong header for these vendors, causing 401 errors.

### Changed

- **`createProvider()` refactored** — OpenAI-compatible vendor cases (Groq, Together, Perplexity, Grok, DeepSeek, Mistral, Ollama) now use `getVendorDefaultBaseURL()` instead of hardcoded URL strings, eliminating duplication and ensuring a single source of truth for vendor endpoints.

### Notes: LLM Proxy Implementation Guide

> **For implementors building LLM proxy servers** (e.g. forwarding SDK requests through a central server):
>
> 1. **Vendor URL resolution**: Use `getVendorDefaultBaseURL(connector.vendor)` as fallback when `connector.baseURL` is empty — LLM connectors typically don't store URLs since provider SDKs handle defaults internally.
>
> 2. **Auth header priority**: For Anthropic, always use `x-api-key`. For Google, always use `x-goog-api-key`. These must take priority over any generic `headerName` in the connector config.
>
> 3. **Body parser interference**: If your server uses `bodyParser.json()` middleware (Express, Meteor, etc.), it will consume the request stream before your proxy handler runs. Check `req.body` first and re-serialize with `JSON.stringify()` instead of reading the raw stream. The request body is just the prompt payload (few KB) — the response stream is unaffected.
>
> 4. **SSE streaming through Meteor/Express**: Compression middleware (e.g. Meteor's built-in `compression`) buffers entire responses before compressing. For SSE responses:
>    - Use `res.setHeader('Content-Encoding', 'identity')` **before** `writeHead()` — `setHeader()` populates the internal header map that compression checks via `getHeader()`. Passing headers only through `writeHead()` bypasses this check.
>    - Call `res.flush()` after each `res.write(chunk)` — compression middleware adds this method to force its buffer to flush immediately.
>    - Set `res.socket.setNoDelay(true)` to disable Nagle's algorithm.
>    - Set `X-Accel-Buffering: no` and `Cache-Control: no-cache` response headers.

- **`apps/api/` — Generic Extensible API Proxy** — New Cloudflare Worker (Hono) serving as a centralized API proxy for OneRingAI clients (Hosea, Amos). Full implementation includes:
  - **Auth system** — Signup, signin, JWT access/refresh tokens, PBKDF2 password hashing via Web Crypto
  - **Centralized model registry** — D1-backed model registry seeded from library `MODEL_REGISTRY`, with admin CRUD and pricing management
  - **Service registry** — Layered resolution (custom_services → service_overrides → library SERVICE_DEFINITIONS)
  - **Encrypted credential storage** — AES-GCM 256-bit encryption for user API keys
  - **Generic proxy** — Forwards requests to any configured service with auth injection, supports both buffered and SSE streaming responses
  - **Usage metering** — DB-driven pricing with platform token rates, vendor cost multipliers, or flat per-request costs. Automatic token deduction with full audit trail
  - **Billing endpoints** — Balance, subscription, transaction, and usage history
  - **Admin system** — Full admin API for user management (suspend/activate), token grants/adjustments, subscription plan changes, model registry CRUD, pricing management (per-model and bulk), service override configuration, platform key management, analytics dashboard, and audit log
  - **Integration tests** — Auth, admin, metering, and credential tests using `@cloudflare/vitest-pool-workers`

- **IMediaStorage Interface & FileMediaStorage** — Pluggable media storage following Clean Architecture.
  - New domain interface `IMediaStorage` with full CRUD: `save()`, `read()`, `delete()`, `exists()`, optional `list()`, `getPath()`
  - New infrastructure implementation `FileMediaStorage` (replaces `FileMediaOutputHandler`)
  - `setMediaStorage()` / `getMediaStorage()` replace `setMediaOutputHandler()` / `getMediaOutputHandler()`
  - `speech_to_text` tool now reads audio through storage (`handler.read()`) instead of hardcoded `fs.readFile()`
  - Tool parameter renamed: `audioFilePath` → `audioSource` in `speech_to_text`
  - Storage is threaded through `registerMultimediaTools()` and all tool factories
  - Deprecated aliases provided for all renamed exports (one version cycle)
  - Factory function `createFileMediaStorage()` for easy instantiation

- **GitHub Connector Tools** — First external service connector tools. When a GitHub connector is registered, `ConnectorTools.for('github')` automatically returns 7 dedicated tools:
  - `search_files` — Search files by glob pattern in a repository (mirrors local `glob`)
  - `search_code` — Search code content across a repository (mirrors local `grep`)
  - `read_file` — Read file content with line ranges from a repository (mirrors local `read_file`)
  - `get_pr` — Get full pull request details (title, state, author, labels, reviewers, merge status)
  - `pr_files` — Get files changed in a PR with diffs
  - `pr_comments` — Get all comments and reviews on a PR (merges review comments, reviews, issue comments)
  - `create_pr` — Create a pull request
  - Shared utilities: `parseRepository()` accepts `"owner/repo"` or full GitHub URLs, `resolveRepository()` with connector `defaultRepository` fallback
  - All tools auto-register via side-effect import following the multimedia tools pattern

### Fixed

- **Hosea: Connector tools not appearing without restart** — After creating/updating/deleting a universal connector in Hosea, `ConnectorTools.clearCache()` and tool catalog invalidation are now called so tools appear immediately without restarting the app.
- **Hosea: Connector tools grouped per-connector** — `connectorName` and `serviceType` are now passed through the full data pipeline (`OneRingToolProvider` → `UnifiedToolEntry` → IPC response) so the Agent Editor's per-connector collapsible sections render correctly instead of dumping all connector tools into a flat "API Connectors" category.
- **Generic API tool POST body handling** — Improved tool parameter descriptions to explicitly instruct LLMs to use the `body` parameter for POST/PUT/PATCH data instead of embedding request data as query string parameters in the endpoint URL. Previously, LLMs would often call e.g. `POST /chat.postMessage?channel=C123&text=hello` instead of using `body: { channel: "C123", text: "hello" }`, causing APIs like Slack to reject the request with "missing required field". The `describeCall` output now also includes truncated body content for easier debugging.

### Breaking Changes

- **Persistent Instructions Plugin - Granular KVP API** — `PersistentInstructionsPluginNextGen`
  now stores instructions as individually keyed entries instead of a single text blob.
  - **`IPersistentInstructionsStorage` interface changed**: `load()` returns `InstructionEntry[] | null`
    (was `string | null`), `save()` accepts `InstructionEntry[]` (was `string`). Custom storage
    backends (MongoDB, Redis, etc.) must be updated.
  - **Tool API changed**: `instructions_append` and `instructions_get` removed.
    Replaced with `instructions_remove` and `instructions_list`. `instructions_set` now takes
    `(key, content)` instead of `(content)`.
  - **Public API changed**: `set(content)` → `set(key, content)`, `append(section)` removed,
    `get()` → `get(key?)`, new `remove(key)` and `list()` methods.
  - **Config changed**: `maxLength` renamed to `maxTotalLength`, new `maxEntries` option.
  - **File format changed**: `custom_instructions.md` → `custom_instructions.json`.
    Legacy `.md` files are auto-migrated on first load.
  - **Session state format changed**: `restoreState()` handles both legacy and new formats.

## [0.1.3] - 2026-02-07

### Fixed

- Fix `getStateAsync is not a function` error in hosea app — updated callers to use the new synchronous `getState()` method on `WorkingMemoryPluginNextGen`

## [0.1.2] - 2026-02-06

### Added

- **Scoped Connector Registry** - Pluggable access control for multi-tenant connector isolation
  - `IConnectorRegistry` interface — read-only registry contract (`get`, `has`, `list`, `listAll`, `size`, `getDescriptionsForTools`, `getInfo`)
  - `IConnectorAccessPolicy` interface — sync predicate with opaque `ConnectorAccessContext`
  - `ScopedConnectorRegistry` class — filtered view over the Connector registry, gated by a user-provided policy
  - `Connector.setAccessPolicy()` / `Connector.getAccessPolicy()` — global policy management
  - `Connector.scoped(context)` — factory for scoped registry views
  - `Connector.asRegistry()` — unfiltered `IConnectorRegistry` adapter over static methods
  - `BaseAgentConfig.registry` — optional scoped registry for `Agent.create()`
  - `ConnectorTools.for()`, `discoverAll()`, `findConnector()`, `findConnectors()` now accept optional `{ registry }` option
  - Security: denied connectors produce the same "not found" error as missing ones (no information leakage)
  - 29 new unit tests

### Fixed

- **WorkingMemoryPluginNextGen state serialization** - `getState()` now returns actual entries instead of an empty array. Added synchronous `_syncEntries` cache to bridge the async `IMemoryStorage` with the synchronous `IContextPluginNextGen.getState()` contract. Session persistence now correctly saves and restores all Working Memory entries.
- **InContextMemory token limit enforcement** - `maxTotalTokens` config is now enforced. Added `enforceTokenLimit()` that evicts low-priority entries when total token usage exceeds the configured limit.
- **Token estimation consistency** - `simpleTokenEstimator` now uses `TOKEN_ESTIMATION.MIXED_CHARS_PER_TOKEN` from centralized constants instead of a hardcoded value.
- **System prompt precedence on session restore** - Explicit `instructions` passed to `Agent.create()` now take precedence over system prompts saved in restored sessions.

### Removed

- **Legacy compaction strategies** - Removed `src/core/context/strategies/` (ProactiveStrategy, AggressiveStrategy, LazyStrategy, AdaptiveStrategy, RollingWindowStrategy, BalancedStrategy). These legacy `IContextStrategy` implementations were dead code never imported by the NextGen context system.
- **SmartCompactor** - Removed `src/core/context/SmartCompactor.ts`. Not used by `AgentContextNextGen`.
- **ContextGuardian** - Removed `src/core/context/ContextGuardian.ts`. Not used by any production code.
- **Legacy strategy constants** - Removed `PROACTIVE_STRATEGY_DEFAULTS`, `AGGRESSIVE_STRATEGY_DEFAULTS`, `LAZY_STRATEGY_DEFAULTS`, `ADAPTIVE_STRATEGY_DEFAULTS`, `ROLLING_WINDOW_DEFAULTS`, `GUARDIAN_DEFAULTS` from `constants.ts`.
- **`WorkingMemoryPluginNextGen.getStateAsync()`** - Removed redundant async method; `getState()` now returns correct data synchronously.

### Changed

- **Documentation** - README.md, USER_GUIDE.md, and CLAUDE.md updated to reflect the actual NextGen compaction system. Replaced references to non-existent `proactive`/`balanced`/`lazy` strategy names with the actual `algorithmic` strategy (default, 75% threshold). Updated custom strategy guidance to use `ICompactionStrategy` + `StrategyRegistry`.

## [0.1.1] - 2026-02-06

### Fixed
- **Multimedia tool naming collisions** - Multiple vendors registering tools with the same base name (e.g., `generate_image`) caused only the last vendor's tools to survive deduplication in UIs. `ConnectorTools.for()` now prefixes service-specific tool names with the connector name (e.g., `google_generate_image`, `main-openai_text_to_speech`), matching the existing generic API tool pattern (`${connector.name}_api`).
- **ToolRegistry display names** - `ToolRegistry` now resolves vendor display names via `getVendorInfo()` and strips connector prefixes for clean display names (e.g., "OpenAI Generate Image", "Google Text To Speech").

### Changed
- **ConnectorTools.for()** - Service-specific tools returned by registered factories are now prefixed with `${connector.name}_`. This is a **breaking change** if you reference multimedia tool names by their old unprefixed names (e.g., `generate_image` → `google_generate_image`).
- **ToolRegistry.deriveDisplayName()** - Accepts `connectorName` parameter, strips connector prefix, prepends vendor display name.

## [0.1.0] - 2026-02-05

### Added
- Initial release of `@everworker/oneringai`
- **Connector-First Architecture** - Single auth system with named connectors
- **Multi-Provider Support** - OpenAI, Anthropic, Google, Groq, DeepSeek, Mistral, Grok, Together, Ollama
- **AgentContextNextGen** - Plugin-based context management
  - WorkingMemoryPluginNextGen - Tiered memory with automatic eviction
  - InContextMemoryPluginNextGen - Key-value storage directly in context
  - PersistentInstructionsPluginNextGen - Disk-persisted agent instructions
- **ToolManager** - Dynamic tool management with enable/disable, namespaces, circuit breakers
- **Tool Execution Plugins** - Pluggable pipeline for logging, analytics, custom behavior
- **Session Persistence** - Save/load full context state with `ctx.save()` and `ctx.load()`
- **Audio Capabilities** - Text-to-Speech and Speech-to-Text (OpenAI, Groq)
- **Image Generation** - DALL-E 3, gpt-image-1, Google Imagen 4
- **Video Generation** - OpenAI Sora 2, Google Veo 3
- **Web Search** - Serper, Brave, Tavily, RapidAPI providers
- **Web Scraping** - ZenRows with JS rendering and anti-bot bypass
- **Developer Tools** - read_file, write_file, edit_file, glob, grep, list_directory, bash
- **MCP Integration** - Model Context Protocol client for stdio and HTTP/HTTPS servers
- **OAuth 2.0** - Full OAuth support with encrypted token storage
- **Vendor Templates** - Pre-configured auth for 43+ services
- **Model Registry** - 23+ models with pricing, context windows, feature flags
- **Direct LLM Access** - `runDirect()` and `streamDirect()` bypass context management
- **Algorithmic Compaction** - Strategy-based context compaction via `StrategyRegistry`

### Providers
- OpenAI (GPT-5.2, GPT-5, GPT-4.1, o3-mini)
- Anthropic (Claude 4.5 Opus/Sonnet/Haiku, Claude 4.x)
- Google (Gemini 3, Gemini 2.5)
- Groq, DeepSeek, Mistral, Grok, Together AI, Ollama

[0.4.0]: https://github.com/Integrail/oneringai/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/Integrail/oneringai/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Integrail/oneringai/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Integrail/oneringai/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/Integrail/oneringai/compare/v0.2.1...v0.2.3
[0.1.3]: https://github.com/Integrail/oneringai/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Integrail/oneringai/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Integrail/oneringai/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Integrail/oneringai/releases/tag/v0.1.0
