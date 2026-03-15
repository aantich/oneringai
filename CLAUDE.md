# Claude Development Guide

## Project Overview

**Name**: `@everworker/oneringai`
**Purpose**: Unified AI agent library with multi-vendor support for text, image, video, audio, and agentic workflows
**Language**: TypeScript (strict mode) | **Runtime**: Node.js 18+ | **Package**: ESM

## Architecture: Connector-First Design

```
User Code → Connector Registry → Agent → Provider Factory → ITextProvider
```

**Key Principles:**
1. **Connectors are single source of truth** for auth - no dual systems
2. **Named connectors** - multiple keys per vendor (`openai-main`, `openai-backup`)
3. **Explicit vendor** - uses `Vendor` enum, no auto-detection
4. **Unified tool management** - `agent.tools === agent.context.tools` (same instance)

## Core Classes

### Connector (`src/core/Connector.ts`)
Static registry for authentication. Supports API keys, OAuth, resilience (retry, circuit breaker, timeout).

```typescript
Connector.create({ name: 'openai', vendor: Vendor.OpenAI, auth: { type: 'api_key', apiKey: '...' } });
const connector = Connector.get('openai');
```

### Agent (`src/core/Agent.ts`)
Main agent class extending BaseAgent. Creates provider from connector, runs agentic loop.

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4', tools: [myTool] });
const response = await agent.run('Hello!');
```

### AgentContextNextGen (`src/core/context-nextgen/AgentContextNextGen.ts`)

**Clean, Plugin-First Context Manager** - modern replacement for legacy AgentContext. Uses a simple, composable plugin architecture.

```typescript
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  systemPrompt: 'You are a helpful assistant.',
  features: { workingMemory: true, inContextMemory: true },
});

// Add user message
ctx.addUserMessage('Hello!');

// Prepare for LLM call (handles compaction if needed)
const { input, budget } = await ctx.prepare();

// Call LLM with input...

// Add assistant response
ctx.addAssistantResponse(response.output);
```

#### Context Structure

```
[Developer Message - All glued together]
  # System Prompt
  # Persistent Instructions (if plugin enabled)
  # Plugin Instructions (for enabled plugins)
  # In-Context Memory (if plugin enabled)
  # Working Memory Index (if plugin enabled)

[Conversation History]
  ... messages including tool_use/tool_result pairs ...

[Current Input]
  User message OR tool results (newest, never compacted)
```

#### Feature Configuration

Features enable/disable plugins. When disabled, associated tools are not registered:

```typescript
interface ContextFeatures {
  workingMemory?: boolean;        // WorkingMemoryPluginNextGen (default: true)
  inContextMemory?: boolean;      // InContextMemoryPluginNextGen (default: false)
  persistentInstructions?: boolean; // PersistentInstructionsPluginNextGen (default: false)
  userInfo?: boolean;             // UserInfoPluginNextGen (default: false)
  toolCatalog?: boolean;          // ToolCatalogPluginNextGen (default: false)
  sharedWorkspace?: boolean;      // SharedWorkspacePluginNextGen (default: false)
}

export const DEFAULT_FEATURES: Required<ContextFeatures> = {
  workingMemory: true,
  inContextMemory: true,
  persistentInstructions: false,
  userInfo: false,
  toolCatalog: false,
  sharedWorkspace: false,
};
```

**Tool Catalog scoping:**
- `toolCategories` scopes built-in categories only (filesystem, web, code, etc.)
- `identities` scopes connector categories only (connector:github, connector:slack, etc.)
- `pinned` categories are always loaded and cannot be unloaded by the LLM
- Plugin tools (memory, context, etc.) are always available, separate from catalog

**Usage:**
```typescript
// Minimal stateless agent
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { workingMemory: false },
});

// Full-featured agent
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { workingMemory: true, inContextMemory: true, persistentInstructions: true },
  agentId: 'my-assistant',  // Required for persistentInstructions
});

// Via Agent.create
const agent = Agent.create({
  connector: 'openai', model: 'gpt-4',
  context: { features: { workingMemory: true, inContextMemory: true } },
});
```

**Key APIs:**
```typescript
ctx.tools;                         // ToolManager instance
ctx.memory;                        // WorkingMemoryPluginNextGen | null
ctx.features;                      // Required<ContextFeatures>
ctx.agentId;                       // string
ctx.sessionId;                     // string | null (if saved/loaded)
ctx.systemPrompt;                  // string | undefined

// Plugin management
ctx.registerPlugin(plugin);        // Add custom plugin
ctx.getPlugin<T>('name');          // Get plugin by name
ctx.hasPlugin('name');             // Check if plugin registered

// Conversation management
ctx.addUserMessage(content);       // Add user message
ctx.addAssistantResponse(output);  // Add assistant response
ctx.addToolResults(results);       // Add tool results
ctx.getConversation();             // Get conversation history
ctx.clearConversation(reason?);    // Clear conversation

// Context preparation
const { input, budget, compacted } = await ctx.prepare();  // Prepare for LLM call

// Session persistence
await ctx.save(sessionId?, metadata?);  // Save to storage
await ctx.load(sessionId);              // Load from storage
```

**Plugin-Based Architecture:**
- Each plugin manages its own token tracking
- Plugins provide: instructions, content, tools
- Compaction happens ONCE, right before LLM call
- Tool pairs (tool_use + tool_result) always removed together

### ToolManager (`src/core/ToolManager.ts`)
Unified tool management + execution. Implements `IToolExecutor`, `IDisposable`. Per-tool circuit breakers.

```typescript
toolManager.register(tool, { namespace: 'weather', priority: 10 });
toolManager.disable('tool_name');
const result = await toolManager.execute('tool_name', args);
```

### Vendor (`src/core/Vendor.ts`)
```typescript
const Vendor = { OpenAI, Anthropic, Google, GoogleVertex, Groq, Together, Grok, DeepSeek, Mistral, Perplexity, Ollama, Custom };
```

## Agent Types

**Agent** (`src/core/Agent.ts`) is the main agent type. It extends **BaseAgent** and uses `AgentContextNextGen` for context management.

### Direct LLM Access (NEW)

All agents inherit `runDirect()` and `streamDirect()` from BaseAgent - bypasses all context management:

```typescript
// Direct call - no history, no memory, no context preparation
const response = await agent.runDirect('Quick question');
const response = await agent.runDirect('Summarize', { instructions: 'Be concise', temperature: 0.5 });

// Streaming
for await (const event of agent.streamDirect('Tell me a story')) { ... }

// Multimodal
await agent.runDirect([{ type: 'message', role: 'user', content: [...] }]);
```

**DirectCallOptions:** `instructions`, `includeTools`, `temperature`, `maxOutputTokens`, `responseFormat`, `vendorOptions`

**Use cases:** Quick one-off queries, testing, hybrid workflows (mix `run()` and `runDirect()`).

## Directory Structure

```
src/
├── index.ts                    # Main exports (~300 items)
├── core/                       # Core architecture
│   ├── Agent.ts, BaseAgent.ts  # Agent classes
│   ├── context-nextgen/        # NextGen context management (PRIMARY)
│   │   ├── AgentContextNextGen.ts  # Main context manager
│   │   ├── types.ts            # Type definitions
│   │   ├── BasePluginNextGen.ts    # Base plugin class
│   │   └── plugins/            # WorkingMemoryPluginNextGen, InContextMemoryPluginNextGen,
│   │                           # PersistentInstructionsPluginNextGen
│   ├── context/                # Legacy types (strategies removed)
│   │   └── types.ts            # Legacy type definitions
│   ├── ToolManager.ts          # Tool management + execution
│   ├── Connector.ts            # Auth registry
│   ├── Vendor.ts               # Vendor enum
│   ├── constants.ts            # All default values
│   ├── TextToSpeech.ts, SpeechToText.ts
│   ├── createProvider.ts, createAudioProvider.ts, createImageProvider.ts, createVideoProvider.ts
│   ├── orchestrator/           # createOrchestrator, orchestration tools
│   ├── permissions/            # ToolPermissionManager
│   └── mcp/                    # MCPClient, MCPRegistry
├── domain/
│   ├── entities/               # Model.ts (23 LLMs), TTSModel, STTModel, ImageModel, VideoModel
│   │                           # Tool.ts, Message.ts, Memory.ts, Task.ts, Services.ts (35+)
│   ├── interfaces/             # ITextProvider, IAudioProvider, IToolExecutor, IDisposable,
│   │                           # IContextStorage, IAgentDefinitionStorage
│   ├── types/                  # SharedTypes.ts
│   └── errors/                 # AIErrors.ts, MCPError.ts
├── capabilities/
│   ├── agents/                 # ExecutionContext.ts, HookManager.ts, EventTypes.ts
│   ├── search/                 # SearchProvider (Serper, Brave, Tavily, RapidAPI)
│   ├── scrape/                 # ScrapeProvider (ZenRows)
│   ├── images/                 # ImageGeneration
│   └── video/                  # VideoGeneration
├── infrastructure/
│   ├── providers/              # OpenAI, Anthropic, Google, Generic
│   │   └── base/               # BaseProvider, BaseTextProvider, BaseMediaProvider
│   ├── resilience/             # CircuitBreaker, BackoffStrategy, RateLimiter
│   ├── observability/          # Logger, Metrics
│   └── storage/                # FileContextStorage, InMemoryStorage
├── tools/
│   ├── filesystem/             # readFile, writeFile, editFile, glob, grep, listDirectory
│   ├── shell/                  # bash
│   ├── web/                    # webFetch, createWebSearchTool, createWebScrapeTool (ConnectorTools)
│   ├── desktop/                # 11 desktop_* tools: screenshot, mouse, keyboard, window (requires @nut-tree-fork/nut-js)
│   ├── connector/              # ConnectorTools (generic API from connector)
│   ├── code/                   # executeJavaScript
│   └── json/                   # jsonManipulator
├── connectors/
│   ├── oauth/                  # OAuthManager, flows
│   └── storage/                # ConnectorConfigStore
└── utils/                      # messageBuilder, clipboardImage, jsonExtractor
```

## Key Patterns

### IDisposable Pattern
Classes with resources implement `destroy(): void` and `isDestroyed: boolean`.
- ToolManager, AgentContextNextGen, plugins (WorkingMemoryPluginNextGen, etc.)

### Plugin-First Architecture
- AgentContextNextGen uses composable plugins for all features
- Each plugin manages its own token tracking and state
- Plugins provide: instructions, content, tools
- Register custom plugins via `ctx.registerPlugin(plugin)`

### Composition Over Inheritance
- Agents extend BaseAgent (creates AgentContextNextGen in constructor)
- Plugins implement `IContextPluginNextGen` interface

### Registry Pattern
- `Connector.create()` / `Connector.get()` - static auth registry
- `MCPRegistry.create()` / `MCPRegistry.get()` - MCP server registry
- `ScrapeProvider` / `SearchProvider` - service-based registries

### Circuit Breaker
Per-tool failure protection in ToolManager:
```typescript
toolManager.setCircuitBreakerConfig('tool', { failureThreshold: 3, resetTimeoutMs: 60000 });
```

## StorageRegistry (`src/core/StorageRegistry.ts`)

Centralized storage backend registry. All subsystems resolve storage lazily at execution time.

```typescript
import { StorageRegistry } from '@everworker/oneringai';

// Configure all backends at once
StorageRegistry.configure({
  customTools: new MongoCustomToolStorage(),
  media: new S3MediaStorage(),
  sessions: (agentId) => new RedisContextStorage(agentId),
  persistentInstructions: (agentId) => new DBInstructionsStorage(agentId),
  workingMemory: () => new RedisMemoryStorage(),
  oauthTokens: new FileTokenStorage(),
});

// Or set individually
StorageRegistry.set('customTools', myStorage);
```

**Storage types:**
- **Global singletons**: `media`, `agentDefinitions`, `connectorConfig`, `oauthTokens`
- **Context-aware factories**: `customTools(ctx?)`, `sessions(agentId, ctx?)`, `persistentInstructions(agentId, ctx?)`, `workingMemory(ctx?)`

**Resolution order** (in every subsystem): explicit constructor param > `StorageRegistry.get()` > file-based default.

**Multi-tenant StorageContext** — All factories receive optional `StorageContext` (opaque `Record<string, unknown>`, same pattern as `ConnectorAccessContext`). Set via `StorageRegistry.setContext({ userId, tenantId })`. Auto-forwarded by `AgentContextNextGen` and custom tool meta-tools (from `ToolContext.userId`).

**Wired into library code:**
- `customTools` — 4 meta-tools resolve factory from registry, pass `ToolContext.userId` as context
- `oauthTokens` — `Connector.defaultStorage` getter resolves from registry
- `media` — `getMediaStorage()` resolves from registry
- `persistentInstructions` — plugin constructor checks registry factory
- `workingMemory` — plugin constructor checks registry factory
- `sessions` — `AgentContextNextGen` constructor checks registry factory
- `agentDefinitions` — `Agent.saveDefinition()` / `Agent.fromStorage()` resolve from registry
- `connectorConfig` — `ConnectorConfigStore.create()` resolves from registry

## Centralized Constants (`src/core/constants.ts`)

| Group | Key Constants |
|-------|---------------|
| TASK_DEFAULTS | TIMEOUT_MS=300000, MAX_RETRIES=3 |
| CONTEXT_DEFAULTS | MAX_TOKENS=128000, COMPACTION_THRESHOLD=0.75 |
| AGENT_DEFAULTS | MAX_ITERATIONS=50, DEFAULT_TEMPERATURE=0.7 |
| CIRCUIT_BREAKER_DEFAULTS | FAILURE_THRESHOLD=5, RESET_TIMEOUT_MS=60000 |
| MEMORY_DEFAULTS | MAX_SIZE_BYTES=25MB, SOFT_LIMIT_PERCENT=80 |

## Context Management Strategies

AgentContextNextGen uses `ICompactionStrategy` implementations registered via `StrategyRegistry`:

| Strategy | Threshold | Description |
|----------|-----------|-------------|
| **algorithmic** (default) | 75% | Moves large tool results to Working Memory, limits tool pairs, applies rolling window |

Custom strategies can be registered via `StrategyRegistry.register(MyStrategy)`.

## Tool Permissions (Policy-Based System)

**Architecture**: 3-tier evaluation in `PermissionPolicyManager.check()`:
1. **User rules pre-check** (highest priority, FINAL) — per-user persistent rules with argument conditions
2. **Parent delegation** (orchestrator workers) — parent deny is final
3. **Policy chain** (built-in policies) — deny short-circuits, allow continues

**Tool self-declaration**: All built-in tools declare `ToolPermissionConfig`:
- `scope: 'always'` (auto-allow): read_file, glob, grep, list_directory, json_manipulate, store_*, todo_*, tool_catalog_*, desktop_get_*, desktop_window_list, orchestrator tools, meta-tools
- `scope: 'session'` (ask once): write_file, edit_file, web_fetch, desktop_mouse_*, desktop_screenshot, desktop_keyboard_key, desktop_window_focus, custom_tool_save/delete, routine tools
- `scope: 'once'` (ask every time): bash, execute_javascript, custom_tool_test, desktop_keyboard_type

**User rules override everything**: `agent.policyManager.userRules` — CRUD API for persistent rules with argument conditions.

**Built-in policies**: AllowlistPolicy, BlocklistPolicy, SessionApprovalPolicy, PathRestrictionPolicy, BashFilterPolicy, UrlAllowlistPolicy, RolePolicy, RateLimitPolicy

**Key files**:
- `src/core/permissions/PermissionPolicyManager.ts` — top-level manager
- `src/core/permissions/UserPermissionRulesEngine.ts` — per-user rules with specificity matching
- `src/core/permissions/PermissionEnforcementPlugin.ts` — ToolManager pipeline plugin
- `src/core/permissions/PolicyChain.ts` — policy evaluation engine
- `src/core/permissions/policies/` — 8 built-in policies
- `src/domain/interfaces/IUserPermissionRulesStorage.ts` — Clean Architecture storage

**Permission allowlist** (backward compat, in DEFAULT_ALLOWLIST): `read_file`, `glob`, `grep`, `list_directory`, `store_get`, `store_set`, `store_delete`, `store_list`, `store_action`, `_start_planning`, `_modify_plan`, `_report_progress`, `_request_approval`, `tool_catalog_search`, `tool_catalog_load`, `tool_catalog_unload`, `todo_add`, `todo_update`, `todo_remove`, `context_stats`

## Working Memory Scopes

```typescript
type SimpleScope = 'session' | 'persistent';
type TaskAwareScope = { type: 'session' } | { type: 'plan' } | { type: 'persistent' } | { type: 'task'; taskIds: string[] };
```

## Model Registry (`src/domain/entities/Model.ts`)

23+ models with pricing, context windows, feature flags:
- **OpenAI**: GPT-5.2 series, GPT-5 family, GPT-4.1, o3-mini
- **Anthropic**: Claude 4.5 (Opus, Sonnet, Haiku), Claude 4.x
- **Google**: Gemini 3 series, Gemini 2.5 series

```typescript
const info = getModelInfo('gpt-5.2');
const cost = calculateCost('gpt-5.2-thinking', inputTokens, outputTokens);
```

## NextGen Plugins

### Unified Store Tools

All CRUD plugins now share 5 generic `store_*` tools instead of having plugin-specific tool names. The `StoreToolsManager` routes calls to the correct `IStoreHandler` plugin based on the `store` argument.

**The 5 tools:**

| Tool | Purpose |
|------|---------|
| `store_get(store, key?)` | Get entry by key, or all entries if key omitted |
| `store_set(store, key, value, ...)` | Create or update an entry |
| `store_delete(store, key)` | Delete an entry by key |
| `store_list(store, options?)` | List entries with optional filtering |
| `store_action(store, action, params?)` | Store-specific operations (e.g., `cleanup_raw`, `clear`, `query`) |

**Available store IDs:** `"memory"`, `"context"`, `"instructions"`, `"user_info"`, `"workspace"` (plus any custom `IStoreHandler` plugins you register).

Each tool's description dynamically lists all registered stores with "use for / NOT for" guidance, so the LLM knows which store to target.

**Creating a custom CRUD plugin:**

Implement both `IContextPluginNextGen` and `IStoreHandler`, then register with the context. The `StoreToolsManager` auto-detects `IStoreHandler` plugins and routes `store_*` calls to them:

```typescript
class MyPlugin extends BasePluginNextGen implements IStoreHandler {
  readonly storeId = 'my_store';
  readonly storeDescription = 'Custom data store for ...';

  async handleGet(key?: string) { /* ... */ }
  async handleSet(key: string, value: unknown, meta?: Record<string, unknown>) { /* ... */ }
  async handleDelete(key: string) { /* ... */ }
  async handleList(options?: Record<string, unknown>) { /* ... */ }
  async handleAction?(action: string, params?: Record<string, unknown>) { /* ... */ }
}

// Register — store tools are available automatically
ctx.registerPlugin(new MyPlugin());
```

### WorkingMemoryPluginNextGen

Tiered memory storage (raw/summary/findings) with automatic eviction. Implements `IStoreHandler` (storeId: `"memory"`).

```typescript
// Access via context
const memory = ctx.memory;  // WorkingMemoryPluginNextGen | null

// Store data
await memory.store('key', 'description', value, 'high');

// Retrieve data
const value = await memory.retrieve('key');

// Query entries
const entries = await memory.list({ tier: 'findings' });
```

**Store tools (via `store_*`):**
- `store_set("memory", key, value, { description, priority })` - Store data in working memory
- `store_get("memory", key)` - Retrieve data by key
- `store_delete("memory", key)` - Delete entry
- `store_list("memory", { tier, pattern })` - List/query memory entries
- `store_action("memory", "cleanup_raw")` - Cleanup raw tier
- `store_action("memory", "query", { tier, pattern, ... })` - Advanced query

### InContextMemoryPluginNextGen

Key-value storage that appears **directly in context** (no retrieval needed). Implements `IStoreHandler` (storeId: `"context"`).

```typescript
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { inContextMemory: true },
});

const plugin = ctx.getPlugin<InContextMemoryPluginNextGen>('in_context_memory');
plugin.set('state', 'Current state', { step: 1 }, 'high');
```

**Store tools (via `store_*`):**
- `store_set("context", key, value, { description, priority })` - Store/update entry
- `store_get("context", key)` - Retrieve entry
- `store_delete("context", key)` - Remove entry
- `store_list("context")` - List all entries with metadata

### PersistentInstructionsPluginNextGen

Agent instructions that persist to disk as individually **keyed entries** across sessions. Implements `IStoreHandler` (storeId: `"instructions"`).

```typescript
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { persistentInstructions: true },
  agentId: 'my-assistant',
});

const plugin = ctx.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions');
await plugin.set('personality', 'Always be helpful.');
await plugin.set('code_rules', 'Follow existing patterns.');

// Get one entry
const entry = await plugin.get('personality');  // InstructionEntry | null

// Get all entries
const all = await plugin.get();  // InstructionEntry[] | null

// Remove one entry
await plugin.remove('code_rules');

// List metadata
const list = await plugin.list();  // { key, contentLength, createdAt, updatedAt }[]
```

**Store tools (via `store_*`):**
- `store_set("instructions", key, content)` - Add/update instruction by key
- `store_get("instructions", key?)` - Get one or all instructions
- `store_delete("instructions", key)` - Remove instruction by key
- `store_list("instructions")` - List all instructions with metadata
- `store_action("instructions", "clear", { confirm: true })` - Clear all instructions

**Config:** `maxTotalLength` (default: 50000), `maxEntries` (default: 50)
**Storage:** `~/.oneringai/agents/<agentId>/custom_instructions.json`

### UserInfoPluginNextGen

User-specific information storage that persists across sessions and agents. Implements `IStoreHandler` (storeId: `"user_info"`). Data is **user-scoped**, not agent-scoped - different agents share the same user data.

```typescript
// Single-user app — no userId needed
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { userInfo: true },
  // No userId — defaults to 'default' user
});

// Multi-tenant app — opt-in isolation
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { userInfo: true },
  userId: 'alice',  // Optional, for multi-user isolation
});
```

**Store tools (via `store_*`):**
- `store_set("user_info", key, value, { description })` - Store/update user information
- `store_get("user_info", key?)` - Retrieve entry by key or all entries
- `store_delete("user_info", key)` - Remove entry by key
- `store_list("user_info")` - List all entries
- `store_action("user_info", "clear", { confirm: true })` - Clear all entries

**Independent tools (NOT via store_*):** `todo_add`, `todo_update`, `todo_remove` remain as standalone tools.

**Config:** `maxTotalSize` (default: 100000 bytes / ~100KB), `maxEntries` (default: 100)
**Storage:** `~/.oneringai/users/<userId>/user_info.json` (defaults to `~/.oneringai/users/default/user_info.json`)

**Design:**
- Plugin is **stateless** - no userId stored in plugin state
- UserId resolved at tool execution time from `ToolContext.userId`
- **userId is optional** — defaults to `'default'` when not provided
- Tools access current user's data only (no cross-user access)
- User data NOT injected into context (`getContent()` returns null)
- Multi-user apps set userId via `Agent.create({ userId })` or `StorageRegistry.setContext({ userId })`

### SharedWorkspacePluginNextGen

Multi-agent coordination bulletin board. Implements `IStoreHandler` (storeId: `"workspace"`). Storage-agnostic with inline content, external references, versioning, author tracking, and append-only conversation log.

```typescript
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { sharedWorkspace: true },
});

const plugin = ctx.getPlugin<SharedWorkspacePluginNextGen>('shared_workspace');
```

**Feature flag:** `features.sharedWorkspace: true`

**Entry model:**
```typescript
interface WorkspaceEntry {
  key: string;
  content?: string;           // Inline content
  references?: string[];      // External references (URLs, file paths, etc.)
  summary: string;            // Short description
  status: string;             // e.g., 'draft', 'ready', 'done'
  author: string;             // Agent or user who created/updated
  version: number;            // Auto-incremented on update
  tags?: string[];            // Optional tags for filtering
  createdAt: string;
  updatedAt: string;
}
```

**Store tools (via `store_*`):**
- `store_set("workspace", key, value, { summary, status, author, tags, references })` - Create/update entry
- `store_get("workspace", key?)` - Get entry or all entries
- `store_delete("workspace", key)` - Remove entry
- `store_list("workspace", { status, tags, author })` - List/filter entries
- `store_action("workspace", "log", { message, author })` - Append to conversation log
- `store_action("workspace", "history", { key })` - Get version history for an entry
- `store_action("workspace", "archive", { key })` - Archive an entry
- `store_action("workspace", "clear", { confirm: true })` - Clear all entries

**Direct API:**
```typescript
plugin.getEntry(key);          // WorkspaceEntry | null
plugin.getAllEntries();         // WorkspaceEntry[]
plugin.getLog();               // LogEntry[] (append-only conversation log)
plugin.appendLog(message, author);  // Append to log
```

## Custom Tools Storage (Optional Per-User Isolation)

Custom tools support optional per-user isolation for multi-tenant scenarios. By default, all tools are stored under the `'default'` user.

**Storage Path:** `~/.oneringai/users/<userId>/custom-tools/<tool-name>.json` (defaults to `~/.oneringai/users/default/custom-tools/`)

**Pattern:** Single storage instance handles all users, userId optional:

```typescript
// Storage interface
interface ICustomToolStorage {
  save(userId: string | undefined, definition: CustomToolDefinition): Promise<void>;
  load(userId: string | undefined, name: string): Promise<CustomToolDefinition | null>;
  list(userId: string | undefined, options?: CustomToolListOptions): Promise<CustomToolSummary[]>;
  delete(userId: string | undefined, name: string): Promise<void>;
  exists(userId: string | undefined, name: string): Promise<boolean>;
  updateMetadata?(userId: string | undefined, name: string, metadata: Record<string, unknown>): Promise<void>;
  getPath(userId: string | undefined): string;
}

// Usage in tools - userId optional
const userId = context?.userId;  // undefined is OK, defaults to 'default'
const storage = resolveCustomToolStorage(explicitStorage, context);
await storage.save(userId, toolDefinition);
```

**Meta-Tools:**
- `custom_tool_save` - Persist custom tool definition
- `custom_tool_load` - Load full definition (including code)
- `custom_tool_list` - List saved tools (filtered by tags/category/search)
- `custom_tool_delete` - Remove custom tool
- `custom_tool_draft` - Validate tool structure
- `custom_tool_test` - Execute code in VM sandbox

All meta-tools work with or without `userId`:

```typescript
// Single-user app - no userId needed
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  // No userId - tools use 'default' user
});

// Multi-tenant app - opt-in per-user isolation
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  userId: 'alice',  // Alice's tools isolated from Bob's
});
```

**Multi-User Isolation (Optional):**
- Provide `userId` to enable per-user isolation
- Each user gets separate directory: `~/.oneringai/users/<userId>/custom-tools/`
- Users cannot access each other's custom tools
- Same tool name allowed for different users (separate namespaces)
- Storage resolution via `StorageRegistry.resolve('customTools', context)`

## InContextMemory

In-context memory for frequently-accessed state stored **directly in context** (not just an index).

**Key Difference from WorkingMemory:**
- **WorkingMemory**: Stores data externally, provides an **index** in context, requires `memory_retrieve()` for values
- **InContextMemory**: Stores data **directly in context**, LLM sees full values immediately

### Setup (NextGen)

```typescript
import { AgentContextNextGen } from '@everworker/oneringai';

// Enable via features
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { inContextMemory: true },
  plugins: {
    inContextMemory: { maxEntries: 20, maxTotalTokens: 4000 },
  },
});

// Access the plugin
const plugin = ctx.getPlugin<InContextMemoryPluginNextGen>('in_context_memory');
```

### Configuration

```typescript
interface InContextMemoryConfig {
  maxEntries?: number;        // Default: 20
  maxTotalTokens?: number;    // Default: 4000
  defaultPriority?: 'low' | 'normal' | 'high' | 'critical';
  showTimestamps?: boolean;   // Default: false
  headerText?: string;        // Default: '## Live Context'
}
```

### Tools

| Tool | Purpose |
|------|---------|
| `store_set("context", ...)` | Store/update key-value pair |
| `store_get("context", ...)` | Retrieve entry |
| `store_delete("context", ...)` | Remove entry to free space |
| `store_list("context")` | List all entries with metadata |

### Priority-Based Eviction

When space is needed, entries are evicted by priority: `low` → `normal` → `high` (oldest first within priority). **Critical** entries are never auto-evicted.

### Direct API Access

```typescript
plugin.set('state', 'Current state', { step: 1 }, 'high');
plugin.get('state');        // { step: 1 }
plugin.has('state');        // true
plugin.delete('state');     // true
plugin.list();              // [{ key, description, priority, updatedAt }]
plugin.clear();             // Remove all
```

### Use Cases

- Current state/status that changes during execution
- User preferences for the session
- Small accumulated results
- Counters, flags, control variables

**Do NOT use for:** Large data (use WorkingMemory), rarely accessed reference data.

## Context Budget

The `prepare()` method returns detailed token budget information:

```typescript
const { input, budget, compacted } = await ctx.prepare();

console.log(budget.totalUsed);           // Total tokens used
console.log(budget.available);           // Remaining tokens
console.log(budget.utilizationPercent);  // Usage percentage
console.log(budget.breakdown);           // Detailed breakdown
```

**Budget Breakdown:**
```typescript
interface ContextBudget {
  maxTokens: number;          // Model's context window
  responseReserve: number;    // Reserved for response
  systemMessageTokens: number; // System message size
  toolsTokens: number;        // Tool definitions
  conversationTokens: number; // Conversation history
  currentInputTokens: number; // Current user input
  totalUsed: number;          // Sum of above
  available: number;          // Remaining capacity
  utilizationPercent: number; // Usage percentage
  breakdown: {                // Detailed breakdown
    systemPrompt: number;
    persistentInstructions: number;
    pluginInstructions: number;
    pluginContents: Record<string, number>;
    tools: number;
    conversation: number;
    currentInput: number;
  };
}
```

## Plugin Instructions

Each plugin provides usage instructions that are automatically injected into the system message:

- **workingMemory=true**: Working Memory workflow, naming conventions (~500 tokens)
- **inContextMemory=true**: In-context memory best practices (~350 tokens)
- **persistentInstructions=true**: Persistent instructions usage (~300 tokens)

Access plugin instructions programmatically:
```typescript
for (const plugin of ctx.getPlugins()) {
  const instructions = plugin.getInstructions();
  console.log(`${plugin.name}: ${plugin.getInstructionsTokenSize()} tokens`);
}
```

## MCP Integration

```typescript
const client = MCPRegistry.create({ name: 'fs', transport: 'stdio', transportConfig: { command: 'npx', args: [...] } });
await client.connect();
client.registerTools(agent.tools);
```

Supports: stdio (local), HTTP/HTTPS (remote) transports.

## Session Persistence

AgentContextNextGen supports full session persistence with `save()` and `load()` methods. This stores and restores:
- Complete conversation history
- All plugin states (WorkingMemory entries, InContextMemory entries, etc.)
- System prompt

### Setup

```typescript
import { AgentContextNextGen, createFileContextStorage } from '@everworker/oneringai';

// Create storage for the agent
const storage = createFileContextStorage('my-agent');
// Stores sessions at: ~/.oneringai/agents/my-agent/sessions/<sessionId>.json

// Create context with storage
const ctx = AgentContextNextGen.create({
  model: 'gpt-4',
  features: { workingMemory: true },
  storage,
});

// Add state
ctx.addUserMessage('Hello');
await ctx.memory?.store('preference', 'User preference', { theme: 'dark' });

// Save session
await ctx.save('session-001', { title: 'My Session', tags: ['test'] });

// Later: Create new context and load
const ctx2 = AgentContextNextGen.create({ model: 'gpt-4', storage });
await ctx2.load('session-001');
// ctx2 now has full conversation and plugin states restored
```

### Key APIs

```typescript
// AgentContextNextGen persistence methods
ctx.sessionId;                              // Current session ID (null if none)
ctx.storage;                                // Storage backend (null if not configured)
await ctx.save(sessionId?, metadata?);      // Save state to storage
await ctx.load(sessionId): boolean;         // Load state from storage
await ctx.sessionExists(sessionId);         // Check if session exists
await ctx.deleteSession(sessionId?);        // Delete session

// Storage interface (IContextStorage)
storage.save(sessionId, state, metadata?);  // Save session
storage.load(sessionId);                    // Load session
storage.delete(sessionId);                  // Delete session
storage.exists(sessionId);                  // Check existence
storage.list(options?);                     // List sessions
```

### Storage Paths

```
~/.oneringai/agents/<agentId>/
├── definition.json              # Agent configuration (if using Agent.saveDefinition)
├── custom_instructions.json      # Persistent instructions (if PersistentInstructionsPluginNextGen enabled)
└── sessions/
    ├── _index.json              # Session index for fast listing
    ├── session-001.json         # Session state
    └── session-002.json
```

## Important Conventions

### Import Extensions
Always use `.js` extension:
```typescript
import { Agent } from './Agent.js';  // Correct
```

### Type Exports
```typescript
export { MessageRole } from './Message.js';  // Enum (runtime value)
export type { Message } from './Message.js';  // Interface (type-only)
```

### Error Handling
Use custom error classes from `src/domain/errors/AIErrors.ts`:
```typescript
throw new ProviderAuthError('openai', 'Invalid API key');
throw new ToolExecutionError('tool_name', 'Reason');
```

## Build Commands

```bash
npm run build          # Build with tsup
npm run dev            # Watch mode
npm run typecheck      # Type check
npm run lint           # ESLint
npm test               # All tests
npm run test:unit      # Unit tests only
npm run test:integration  # Integration tests (requires API keys)
```

## Key Interfaces

| Interface | Purpose | File |
|-----------|---------|------|
| ITextProvider | Text generation | `src/domain/interfaces/ITextProvider.ts` |
| IToolExecutor | Tool execution | `src/domain/interfaces/IToolExecutor.ts` |
| IDisposable | Resource cleanup | `src/domain/interfaces/IDisposable.ts` |
| IHistoryManager | History management | `src/domain/interfaces/IHistoryManager.ts` |
| IContextStorage | Context session persistence | `src/domain/interfaces/IContextStorage.ts` |
| IAgentDefinitionStorage | Agent config persistence | `src/domain/interfaces/IAgentDefinitionStorage.ts` |

## Services Registry (`src/domain/entities/Services.ts`)

35+ external services with metadata: Slack, GitHub, Stripe, Salesforce, Zendesk, etc.

```typescript
Connector.create({ name: 'github', serviceType: Services.Github, auth: {...}, baseURL: 'https://api.github.com' });
const tools = ConnectorTools.for('github');  // Generic API tool
```

## Lifecycle Hooks

```typescript
const agent = Agent.create({
  connector: 'openai', model: 'gpt-4',
  lifecycleHooks: {
    beforeToolExecution: async (ctx) => { /* can throw to block */ },
    afterToolExecution: async (result) => { /* logging */ },
    beforeCompaction: async (ctx) => { /* save important data */ },
    onError: async (error, ctx) => { /* alerting */ },
  },
});
```

## Adding New Vendors

1. Add to `Vendor` enum (`src/core/Vendor.ts`)
2. Create provider (`src/infrastructure/providers/newvendor/NewVendorTextProvider.ts`)
3. Register in factory (`src/core/createProvider.ts`)

## ToolFunction Definition

```typescript
const myTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'tool_name',
      description: 'What it does',
      parameters: { type: 'object', properties: {...}, required: [...] },
    },
  },
  execute: async (args) => ({ result: 'value' }),
  describeCall: (args) => args.key,  // For logging
};
```

## Agent Orchestrator (`src/core/orchestrator/`)

Multi-agent coordination via `createOrchestrator()`. The orchestrator is a regular Agent with orchestration tools — no subclass.

### Usage

```typescript
import { createOrchestrator } from '@everworker/oneringai';

const orchestrator = createOrchestrator({
  connector: 'openai',
  model: 'gpt-4',
  agentTypes: {
    architect: { systemPrompt: '...', tools: [readFile, writeFile] },
    critic: { systemPrompt: '...', tools: [readFile] },
    developer: { systemPrompt: '...', tools: [readFile, writeFile, editFile, bash] },
  },
});

const result = await orchestrator.run('Build an auth module');
```

### Architecture

- **Orchestrator** = Agent with 7 orchestration tools + shared workspace
- **Workers** = persistent Agent instances created via `create_agent` tool
- **SharedWorkspacePlugin** = shared bulletin board (same instance on all agents)
- **Workspace Delta** = workers auto-receive "what changed since your last turn"
- **Async turns** = `assign_turn_async` uses `blocking: false` (async tools infrastructure)

### Orchestration Tools (7)

| Tool | Blocking | Purpose |
|------|----------|---------|
| `create_agent(name, type)` | yes | Spawn worker from `agentTypes` |
| `list_agents()` | yes | Show team status |
| `destroy_agent(name)` | yes | Remove worker |
| `assign_turn(agent, instruction, timeout?)` | **yes** | Sequential — wait for result |
| `assign_turn_async(agent, instruction, timeout?)` | **no** | Async — result via continuation |
| `assign_parallel(assignments[], timeout?)` | yes | Fan-out, wait for all |
| `send_message(agent, message)` | yes | Inject into running/idle agent |

### Agent.inject()

```typescript
agent.inject('Please also consider rate limiting', 'user');
```

Queues a message into a running agent's context. Processed on next agentic loop iteration. Used by `send_message` tool internally.

### OrchestratorConfig

```typescript
interface OrchestratorConfig {
  connector: string;
  model: string;
  systemPrompt?: string;            // Override auto-generated prompt
  agentTypes: Record<string, AgentTypeConfig>;
  workspace?: Partial<SharedWorkspaceConfig>;
  name?: string;                    // Default: 'orchestrator'
  agentId?: string;                 // For session persistence
  maxIterations?: number;           // Default: 100
}

interface AgentTypeConfig {
  systemPrompt: string;
  tools?: ToolFunction[];
  model?: string;                   // Override per-type
  connector?: string;               // Override per-type
}
```

### Key Files

| File | Purpose |
|------|---------|
| `src/core/orchestrator/createOrchestrator.ts` | Factory + system prompt + worker factory |
| `src/core/orchestrator/tools.ts` | 7 tool definitions + workspace delta builder |
| `src/core/orchestrator/index.ts` | Exports |
| `src/core/Agent.ts` | `inject()` method |

---

**Version**: 0.5.0 | **Last Updated**: 2026-03-14 | **Architecture**: Connector-First + NextGen Context
