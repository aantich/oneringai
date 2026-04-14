# Changelog

All notable changes to Everworker Desktop will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

---

## [0.2.1] - 2026-03-12

### Added
- **Multimedia Connector Selector** — Choose which connector to use for image, video, and TTS generation. Dropdown appears when multiple multimedia-capable connectors are configured. Models filter to the selected connector's vendor. Connector name is passed through to generation calls for explicit key selection.
- **Audio Streaming** — Basic audio streaming support for text-to-speech during agent conversations
- **Chat History Page** — Browse and search past agent conversations
- **User Info Plugin** — New agent context plugin (`userInfo` feature flag) for persistent user preferences across sessions and agents. User-scoped storage at `~/.oneringai/users/<userId>/user_info.json`
- **Tool Categories & Catalog** — Reorganized tool system with categories (filesystem, web, code, desktop, routines, etc.) and dynamic tool catalog plugin for agents
- **Routine Tools Migration** — Routine execution tools updated to the new tool registration system
- **Voice / TTS Support** — Agents can now speak responses aloud using text-to-speech
  - **Agent Editor**: Voice tab with TTS connector, model, voice, format, and speed settings
  - **Chat voiceover toggle**: Speaker icon enables/disables voice during chat. Audio plays as sentences complete (pseudo-streaming via VoiceStream)
  - **Skip button**: Stop current voice playback mid-sentence
  - **Supported formats**: MP3 (default, recommended), Opus, AAC, FLAC, WAV. PCM format available but streaming playback is experimental (known quality issues)
  - **Multi-vendor**: Works with any TTS connector (OpenAI tts-1, tts-1-hd, gpt-4o-mini-tts)
- **What's New Popup** — Shows release highlights after every version update. Appears once after the license acceptance step. Includes a version dropdown to browse previous releases. Content is stored as markdown files in `src/renderer/whatsnew/` and bundled at build time via Vite `?raw` imports.
- **Local AI with Ollama** — Run AI models locally without API keys or cloud services
  - **OllamaService** (main process) — Full lifecycle management: auto-detect existing installations, download binary (~70MB), start/stop server, pull/delete models
  - **Smart model recommendations** — Based on system RAM: qwen3:8b (<12GB), qwen3:14b (12-24GB), qwen3:30b (24GB+)
  - **Settings > Local AI** — New settings tab with full Ollama management: status, model list, pull/delete, auto-start toggle, system info
  - **Onboarding integration** — SetupModal now shows "Run Locally with Ollama" as a first-class option alongside "Add API Key" for new users with no connectors
  - **LLM Connectors page** — Managed Ollama connector shows "Managed by Everworker Desktop" badge; hint banner for users without Ollama set up
  - **External Ollama detection** — If Ollama is already installed or running externally, Everworker Desktop detects and reuses it without redundant downloads
  - **Auto-start** — Optional auto-start on Everworker Desktop launch (enabled by default)
  - **IPC + Preload bridge** — Full `window.hosea.ollama` API with push events for download progress, pull progress, and state changes
  - Binary stored at `~/.everworker/hosea/ollama/`, config at `~/.everworker/hosea/ollama-config.json`
  - Supports macOS (arm64/x64), Linux (amd64/arm64); Windows download stubbed with manual install fallback
- **OAuth Scope Selector** — New `ScopeSelector` component in the connector creation and edit forms. Replaces the plain-text scope input with a checkbox-based selector showing template-defined scopes with human-readable descriptions. All template scopes are pre-checked by default. Users can toggle individual scopes on/off and add custom scopes via a text input. Available in both the Create Connector page and the Edit Connector modal.
- **Automatic OAuth Flow for Vendor Connectors** — One-click OAuth authorization for any vendor that requires OAuth (QuickBooks, GitHub OAuth, Ramp, etc.)
  - `OAuthCallbackServer` — Temporary localhost HTTP server on port 19876 catches OAuth redirects. Users register `http://localhost:19876/oauth/callback` once with their provider.
  - `VendorOAuthService` — Orchestrates the full OAuth dance: opens a BrowserWindow, user logs in at the vendor, callback is caught, tokens are exchanged and stored.
  - Supports both `authorization_code` (user tokens, e.g. QuickBooks) and `client_credentials` (app tokens, e.g. Ramp) flows.
  - Persistent token storage via encrypted `FileStorage` — tokens survive app restarts. AES-256-GCM encryption with auto-generated key.
  - Auto-refresh: token refresh happens transparently via the core library's `AuthCodePKCEFlow`.
  - UI: Redirect URI is shown as a read-only info box (not an editable field) during connector creation. After creation, an "Authorize" button opens the OAuth flow. Connector cards on the list page show "Authorize" for OAuth connectors that haven't been authorized yet.
  - IPC bridge: `oauth:start-flow`, `oauth:cancel-flow`, `oauth:token-status`, `oauth:get-redirect-uri` handlers with full preload typing.
- **Browser-Based EverWorker Login** - One-click authentication replaces manual JWT token entry
  - "Login to EverWorker" button opens a browser window to the EW login page
  - Supports all EW auth methods (password, Microsoft SSO, OIDC, etc.) via generic `returnTo` mechanism
  - Token (30-day, `llm:proxy` scope) is automatically generated and stored in profile after login
  - Token status badges on profile cards: "Token expired" (red) or "Expires in Xd" (yellow)
  - One-click re-authentication button for expired/expiring tokens
  - Displays authenticated user name on profile cards
  - Graceful fallback to manual token entry for older EW instances without browser auth support
  - Version detection: checks `/api/v1/hosea-auth/status` before opening auth window
  - Token expiry checked on app startup with push notification to renderer
  - Expired tokens block sync attempts with clear error message
- **Multi-Profile Everworker Backend** - Support multiple named EW backend profiles with instant switching
  - Add, edit, delete named profiles (e.g., Production, Staging, Dev)
  - Active profile dropdown with live switching — purges old connectors and syncs new ones immediately
  - Per-profile test connection and sync buttons
  - Profile cards showing connector count, last sync time, and status
  - Auto-migration from old single `everworker-backend.json` format to new `everworker-profiles.json`
  - Legacy API wrappers maintained for backward compatibility
- **Live Connector Refresh** - Switching EW profiles now pushes `everworker:connectors-changed` events to the renderer
  - LLM Connectors, Universal Connectors, Tool Connectors, Agent Editor, and Agents pages auto-refresh when connectors change
  - Uses React Context (`ConnectorVersionContext`) for efficient re-rendering
- **Agent Connector Availability** - Agents page now checks if each agent's connector is available
  - Agents with unavailable connectors are grayed out (50% opacity) with a warning icon
  - Chat button is disabled for agents whose connector is missing (e.g., after EW profile switch)
  - Tooltip explains the issue and suggests switching EW profile or editing the agent
  - Edit button remains enabled so users can reassign the agent to a different connector
- **Dynamic Version Display** - About page and Settings modal now show version from `package.json` via `app.getVersion()` IPC
  - Added `window.hosea.app.getVersion()` preload API
  - Replaced hardcoded "Version 0.1.0" in both SettingsPage and SettingsModal
- **Current Context Display in Dynamic UI** - In-context memory entries can now be shown in the sidebar
  - New `showInUI` field on `InContextEntry` — agents set it via `context_set` tool to display entries in the sidebar
  - Tool description references system prompt formatting capabilities (markdown, code blocks, diagrams, charts, etc.)
  - New "Current Context" section in Dynamic UI tab renders entries as cards with full markdown rendering
  - Each card shows key name, priority badge, description, and markdown-rendered value (same `MarkdownRenderer` as chat)
  - User pin/unpin toggle per entry — pinned keys always show regardless of agent's `showInUI` setting
  - Pinned keys persist per-agent to `~/.oneringai/agents/<id>/ui_config.json`
  - Real-time updates via `onEntriesChanged` callback with 100ms debounce
  - New `ui:context_entries` stream chunk type for main→renderer IPC
  - Notification dot on Dynamic UI tab when context entries update while on another tab
  - **Collapsible context cards** — click card header to collapse/expand, showing only the key name when collapsed
  - **Full-view mode** — maximize button on each card fills the entire sidebar with that card's scrollable content; other cards and Dynamic UI are hidden until exiting full view

### Fixed
- **Current Context entries not appearing** - Context entries with `showInUI: true` were not reliably delivered to the renderer due to the 100ms debounce timer firing after the stream ended. Added a final flush of InContextMemory entries at the end of each `streamInstance()` call to guarantee delivery.
- **Multimedia connector selection** — Image, video, and TTS generation no longer silently picks the first connector for a vendor. Users can now explicitly choose which connector (API key) to use.
- **Better agent error handling** — Improved error messages and recovery during agent execution

### Changed
- **Settings > Everworker Backend** - Complete UI redesign for multi-profile management
  - Replaced single URL/token form with profile-based card layout
  - Added Add/Edit modal, Delete confirmation, and per-profile action buttons (Test, Sync, Activate, Edit, Delete)
- **Product name** — App renamed from "HOSEA" to "Everworker Desktop"

### Fixed
- **Version display** - About page now shows actual app version instead of hardcoded "0.1.0"

---

## [0.1.5] - 2026-02-08

### Added
- **Everworker Backend Proxy Integration** - Connect Everworker Desktop to an Everworker backend for centrally managed AI connectors
  - API keys managed on the EW server, not stored on desktops
  - JWT-based authentication with `llm:proxy` scope
  - Transparent HTTP reverse proxy - all vendor SDKs work without changes via `baseURL` override
  - **Mixed mode**: local connectors and EW connectors coexist seamlessly
  - Works for all connector types: LLM text, image, video, TTS, web search, universal APIs
- **Settings > Everworker Backend** - New settings section to configure EW backend connection
  - Backend URL and JWT token configuration
  - Test connection button to verify connectivity
  - Sync connectors button to fetch available connectors from EW
  - Enable/disable toggle for EW integration
- **Connector Source Badges** - LLM Providers page shows "EW" badge for Everworker connectors and "Local" badge for local ones
  - EW connectors show available models
  - EW connectors are marked as "Managed by Everworker" (key management disabled)
- **IPC Bridge** - New `window.hosea.everworker` API for renderer communication
  - `getConfig()`, `setConfig()`, `testConnection()`, `syncConnectors()`
- **Connector Source Tracking** - `StoredConnectorConfig` now includes `source` field (`'local' | 'everworker'`)

### Fixed
- **EW Sync: Non-LLM connectors no longer appear in LLM Providers** - `syncEWConnectors()` now routes connectors by type: LLM vendors (openai, anthropic, etc.) go to the LLM providers store, while non-LLM services (slack, github, zenrows, serper, etc.) go to the Universal Connectors store
- **EW Sync counter** - Sync now reports "X added, Y updated, Z removed" instead of showing "0 added" on re-sync
- **EW Proxy: 0 connectors available** - Proxy discovery endpoint now reads from the oneringai `Connector` registry (populated by V25 startup) instead of a separate empty Map
- **EW discovery endpoint** - Now includes `type` ('llm' | 'universal') and `serviceType` fields for each connector
- **Improved logging** - Added detailed logging for EW connection testing and connector discovery on both Everworker Desktop and EW sides

### Changed
- **Universal Connectors page** - Now shows EW/Local source badges, similar to LLM Providers page; EW-managed connectors show "Managed" instead of Edit
- **StoredUniversalConnector** - Added optional `source` field (`'local' | 'everworker'`)

### Removed
- **Legacy API Connectors system** - Removed dead `apiConnectors` Map, `StoredAPIConnectorConfig` interface, `loadAPIConnectors()` method, CRUD methods, IPC handlers (`api-connector:*`), and preload bridge. The migration function (`migrateAPIConnectorsToUniversal`) is preserved for existing users

## [0.1.0] - 2026-02-05

### Added
- Initial release of Everworker Desktop (Human-Oriented System for Engaging Agents)
- **Desktop Application** - Electron-based cross-platform UI for AI agents
- **Chat Interface** - Multi-turn conversation with AI agents
- **Agent Configuration** - Configure connectors, models, and tools
- **Tool Management** - Enable/disable tools, view tool catalog
- **Connector Management** - Create and manage API connectors for various services
- **Browser Automation** - Built-in browser tools for web interaction
- **Rich Message Rendering**
  - Markdown with GitHub Flavored Markdown (GFM)
  - Syntax highlighting for code blocks
  - LaTeX/KaTeX for math equations
  - Mermaid diagrams
  - Markmap mind maps
  - Vega/Vega-Lite charts
- **Settings Management** - Persistent settings with electron-store
- **Vendor Logos** - Visual icons for 40+ service integrations

### Technical
- Built with Electron 29, React 18, TypeScript 5
- Vite for fast development and building
- Bootstrap 5 + React Bootstrap for UI components
- Integrates with `@everworker/oneringai` core library

[Unreleased]: https://github.com/aantich/oneringai/compare/hosea-v0.1.0...HEAD
[0.1.0]: https://github.com/aantich/oneringai/releases/tag/hosea-v0.1.0
