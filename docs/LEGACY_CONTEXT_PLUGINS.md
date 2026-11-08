# Context plugin migration reference

This archive is for existing integrations only. New plugins should follow
[Creating context plugins](../USER_GUIDE.md#creating-context-plugins): register
a plugin and a contributor, keep trusted guidance in `getInstructions()`, and
return context data through `contribute()`. For durable knowledge and profiles,
use the [memory system](../USER_GUIDE.md#self-learning-memory-nextgen-plugin).

The API descriptions below are retained for migration. They do not recommend
deprecated stores or instruction-channel data injection for new code.

### Migration from Old Tool Names

| Old Tool | New Equivalent |
|----------|---------------|
| `memory_store(key, desc, value, ...)` | `store_set("notes", key, { description, value, tier?, ... })` |
| `memory_retrieve(key)` | `store_get("notes", key)` |
| `memory_delete(key)` | `store_delete("notes", key)` |
| `memory_query(...)` | `store_action("notes", "query", { pattern?, tier?, ... })` |
| `memory_cleanup_raw()` | `store_action("notes", "cleanup_raw")` |
| `context_set(key, desc, value, ...)` | `store_set("whiteboard", key, { description, value, priority? })` |
| `context_delete(key)` | `store_delete("whiteboard", key)` |
| `context_list()` | `store_list("whiteboard")` |
| `instructions_set(key, content)` | `store_set("instructions", key, { content })` |
| `instructions_remove(key)` | `store_delete("instructions", key)` |
| `instructions_list()` | `store_list("instructions")` |
| `instructions_clear(confirm)` | `store_action("instructions", "clear", { confirm: true })` |
| `user_info_set(key, value, desc?)` | `store_set("user_info", key, { value, description? })` |
| `user_info_get(key?)` | `store_get("user_info", key?)` |
| `user_info_remove(key)` | `store_delete("user_info", key)` |
| `user_info_clear(confirm)` | `store_action("user_info", "clear", { confirm: true })` |

> **Note:** TODO tools (`todo_add`, `todo_update`, `todo_remove`) are unchanged.


#### Instructions Store

```jsonc
// Set a persistent instruction
{
  "name": "store_set",
  "arguments": {
    "store": "instructions",
    "key": "personality",
    "data": {
      "content": "Always be friendly and helpful. Use clear, simple language."
    }
  }
}

// Remove an instruction
{
  "name": "store_delete",
  "arguments": {
    "store": "instructions",
    "key": "personality"
  }
}

// Clear all instructions
{
  "name": "store_action",
  "arguments": {
    "store": "instructions",
    "action": "clear",
    "params": { "confirm": true }
  }
}
```

#### User Info Store

```jsonc
// Store user preference
{
  "name": "store_set",
  "arguments": {
    "store": "user_info",
    "key": "theme",
    "data": {
      "value": "dark",
      "description": "User preferred theme"
    }
  }
}

// Get all user info
{
  "name": "store_get",
  "arguments": {
    "store": "user_info"
  }
}

// Clear all user info
{
  "name": "store_action",
  "arguments": {
    "store": "user_info",
    "action": "clear",
    "params": { "confirm": true }
  }
}
```


## Persistent Instructions (NextGen Plugin)

> ⚠️ **Deprecated** in favour of [`MemoryPluginNextGen`](../USER_GUIDE.md#self-learning-memory-nextgen-plugin). This plugin keeps working unchanged for existing integrations — no breaking change — but new code should prefer the memory plugin, which replaces dumb KV with append-only facts + LLM-synthesised profiles that evolve from observations.

**PersistentInstructionsPluginNextGen** is a context plugin that stores agent-level custom instructions on disk as **individually keyed entries**. Unlike InContextMemory (volatile key-value pairs), persistent instructions survive process restarts and are automatically loaded when the agent starts.

### Key Difference from InContextMemory

| Feature | InContextMemory | Persistent Instructions |
|---------|-----------------|------------------------|
| **Storage** | In-memory (volatile) | Disk (persistent JSON) |
| **Survives restarts** | No | Yes |
| **Best for** | Session state, counters, flags | Agent personality, learned rules |
| **LLM can modify** | Yes (store_set("whiteboard", ...)) | Yes (store_set/store_delete("instructions", ...)) |
| **Auto-loaded** | Via session restore | Always on agent start |
| **Default capacity** | 20 entries, 40,000 tokens | 50 entries, 50,000 chars total |

### Quick Setup

```typescript
import { Agent } from 'oneringai';

const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    model: 'gpt-4.1',
    agentId: 'my-assistant',  // Used for storage path
    features: {
      persistentInstructions: true,  // Enables PersistentInstructionsPluginNextGen
    },
  },
});

// Plugin is accessible via ctx.getPlugin('persistent_instructions')
// Instructions are automatically loaded from disk on first context prepare
```

### Manual Setup

For more control, you can set up the plugin manually:

```typescript
import { AgentContextNextGen, PersistentInstructionsPluginNextGen } from 'oneringai';

const ctx = AgentContextNextGen.create({ model: 'gpt-4.1' });

// Create and configure plugin
const plugin = new PersistentInstructionsPluginNextGen({
  agentId: 'my-assistant',
  maxTotalLength: 100000,  // Characters across all entries, default is 50000
  maxEntries: 50,          // Maximum number of keyed entries, default is 50
});

// Register with context
ctx.registerPlugin(plugin);

// Set instructions programmatically (keyed entries)
await plugin.set('personality', 'Always respond in a friendly tone.');
await plugin.set('formatting', 'Prefer bullet points for lists.');
```

### Configuration Options

```typescript
interface PersistentInstructionsConfig {
  /** Agent ID - used to determine storage path (required) */
  agentId: string;

  /** Custom storage implementation (default: FilePersistentInstructionsStorage) */
  storage?: IPersistentInstructionsStorage;

  /** Maximum total content length across all entries in characters (default: 50000) */
  maxTotalLength?: number;

  /** Maximum number of entries (default: 50) */
  maxEntries?: number;
}
```

### Storage Path

Instructions are stored at:
- **Unix/macOS**: `~/.oneringai/agents/<agentId>/custom_instructions.json`
- **Windows**: `%APPDATA%/oneringai/agents/<agentId>/custom_instructions.json`

The agent ID is sanitized to be filesystem-safe (lowercase, special chars replaced with underscores).

### Available Tools

The LLM manages persistent instructions through the unified `store_*` tools with `store="instructions"`:

#### store_set("instructions", ...)

Add or update a single instruction by key:

```jsonc
// Tool call from LLM
{
  "name": "store_set",
  "arguments": {
    "store": "instructions",
    "key": "personality",
    "data": {
      "content": "Always be friendly and helpful. Use clear, simple language."
    }
  }
}
// Returns: { "success": true, "message": "Instruction 'personality' added", "key": "personality", "contentLength": 57 }
```

#### store_delete("instructions", ...)

Remove a single instruction by key:

```jsonc
// Tool call from LLM
{
  "name": "store_delete",
  "arguments": {
    "store": "instructions",
    "key": "personality"
  }
}
// Returns: { "deleted": true, "key": "personality" }
```

#### store_list("instructions")

List all instructions with their keys and content:

```jsonc
// Tool call from LLM
{
  "name": "store_list",
  "arguments": {
    "store": "instructions"
  }
}
// Returns: {
//   "total": 2,
//   "entries": [
//     { "key": "personality", "contentLength": 57, "createdAt": ..., "updatedAt": ... },
//     { "key": "formatting", "contentLength": 35, "createdAt": ..., "updatedAt": ... }
//   ]
// }
```

#### store_action("instructions", "clear", ...)

Remove all instructions (requires confirmation):

```jsonc
// Tool call from LLM
{
  "name": "store_action",
  "arguments": {
    "store": "instructions",
    "action": "clear",
    "params": { "confirm": true }
  }
}
// Returns: { "success": true, "action": "clear", "message": "All custom instructions cleared" }
```

### Direct API Access

The plugin provides a programmatic API for direct manipulation:

```typescript
const plugin = ctx.getPlugin<PersistentInstructionsPluginNextGen>('persistent_instructions')!;

// Add/update entry by key
await plugin.set('personality', 'Always be friendly and helpful.');
await plugin.set('formatting', 'Use bullet points for lists.');

// Get single entry by key
const entry = await plugin.get('personality');  // InstructionEntry | null
// entry = { id: 'personality', content: '...', createdAt: ..., updatedAt: ... }

// Get all entries (sorted by createdAt)
const all = await plugin.get();  // InstructionEntry[] | null

// List metadata for all entries
const list = await plugin.list();
// [{ key: 'personality', contentLength: 35, createdAt: ..., updatedAt: ... }, ...]

// Remove a single entry
await plugin.remove('formatting');  // true if found, false if not

// Clear all
await plugin.clear();
```

### Context Output Format

When the LLM context is prepared, persistent instruction entries are rendered as markdown sections:

```markdown
### personality
Always be friendly and helpful. Use clear, simple language.

### formatting
- Use bullet points for lists
- Keep responses concise

### user_preferences
The user prefers dark mode and verbose explanations.
```

### Session Persistence

PersistentInstructionsPluginNextGen supports state serialization. The state format includes all entries:

```typescript
// State includes all entries
const state = plugin.getState();
// state = { entries: [...], agentId: "my-assistant", version: 2 }

// Restore state (useful for in-memory state sync)
plugin.restoreState(state);
// Also handles legacy format: { content: string | null, agentId: string }
```

### Use Cases

**Ideal for:**
- **Agent personality/behavior** - Tone, style, expertise areas
- **User preferences** - Formatting, verbosity, topics of interest
- **Learned rules** - Patterns discovered during conversation
- **Tool usage guidelines** - When to use specific tools
- **Custom instructions** - Domain-specific knowledge

**Example: Building a Learning Assistant**

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  instructions: `You are a learning assistant. When the user expresses preferences or
gives feedback about your responses, use store_set("instructions", key, { content }) to remember them for
future sessions. Use descriptive keys like "user_preferences", "response_style", etc.
Review your instructions with store_list("instructions") at the start of each conversation.`,
  context: {
    model: 'gpt-4.1',
    agentId: 'learning-assistant',
    features: { persistentInstructions: true },
  },
});

// User: "I prefer when you explain things with analogies"
// Agent calls: store_set("instructions", "response_style", { content: "Explain concepts using analogies when possible" })
// Next session, agent sees this in context automatically
```

### Best Practices

#### 1. Use Descriptive Keys

```typescript
// GOOD: Descriptive, categorical keys
await plugin.set('personality', 'Be friendly and approachable');
await plugin.set('formatting_rules', 'Use bullet points for lists');
await plugin.set('domain_knowledge', 'User works in fintech');

// AVOID: Generic or numbered keys
await plugin.set('rule1', '...');  // Not descriptive
await plugin.set('misc', '...');   // Too vague
```

#### 2. One Concern Per Entry

```typescript
// GOOD: Each entry covers one topic
await plugin.set('tone', 'Use formal language');
await plugin.set('code_style', 'Use TypeScript, follow existing patterns');
await plugin.set('response_length', 'Keep responses concise, 2-3 paragraphs max');

// AVOID: Mixing concerns in one entry
await plugin.set('rules', 'Be formal. Use TypeScript. Keep it short.');
```

#### 3. Combine with InContextMemory

Use both systems for their strengths:

```typescript
// Persistent instructions for long-term knowledge
// - Agent personality
// - User preferences
// - Learned rules

// InContextMemory for session-specific state
// - Current task progress
// - Temporary flags
// - Running totals
```

#### 4. Set Reasonable Limits

```typescript
// For simple agents
const agent = Agent.create({
  context: {
    features: { persistentInstructions: true },
    plugins: { persistentInstructions: { maxTotalLength: 10000, maxEntries: 20 } },
  },
});

// For complex agents with lots of learned rules
const agentVariant2 = Agent.create({
  context: {
    features: { persistentInstructions: true },
    plugins: { persistentInstructions: { maxTotalLength: 100000, maxEntries: 100 } },
  },
});
```

### Upgrade Guide (from single-string to KVP)

If upgrading from the previous single-string persistent instructions:

1. **File storage**: Auto-migrated. Legacy `custom_instructions.md` files are read as a single `legacy_instructions` entry and converted to `custom_instructions.json` on next save. No action needed.
2. **Custom storage backends**: Update `load()` to return `InstructionEntry[] | null` and `save()` to accept `InstructionEntry[]` instead of `string`.
3. **Tool API**: `instructions_append` is removed — use `store_set("instructions", key, { content })` to add new entries. `instructions_get` is removed — use `store_list("instructions")` to see all entries.
4. **Programmatic API**: `plugin.set(content)` → `plugin.set(key, content)`. `plugin.append(section)` → `plugin.set(newKey, section)`. `plugin.get()` now returns `InstructionEntry[] | null` (or a single `InstructionEntry` when called with a key).
5. **Session state**: Existing saved sessions with old format (`{ content: string | null }`) are auto-migrated on `restoreState()`.

---

## User Info (NextGen Plugin)

> ⚠️ **Deprecated** in favour of [`MemoryPluginNextGen`](../USER_GUIDE.md#self-learning-memory-nextgen-plugin). This plugin keeps working unchanged; the memory plugin supersedes it with facts-over-KV, supersession-preserved history, LLM-synthesised profiles, three-principal permissions, and semantic recall.

Store user-specific preferences and context that persist across sessions and agents. Unlike other plugins, user info is **user-scoped** (not agent-scoped) — different agents share the same user's data.

User info entries are **automatically injected into the LLM system message** as markdown, so the LLM always knows the user's preferences without needing to call `store_get("user_info")` each turn.

### Setup

```typescript
import { Agent } from 'oneringai';

// Single-user app — no userId needed
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  context: {
    model: 'gpt-4.1',
    features: { userInfo: true },
  },
});

// Multi-user app — opt-in per-user isolation
const agentVariant2 = Agent.create({
  connector: 'openai',
  model: 'gpt-4.1',
  userId: 'alice',
  context: {
    model: 'gpt-4.1',
    features: { userInfo: true },
  },
});
```

### How It Works

1. **Lazy Loading** — On first access (tool call or `getContent()`), entries are loaded from storage into an in-memory cache
2. **Context Injection** — `getContent()` renders entries as markdown in the system message. Regular user info and TODOs are shown in separate sections:
   ```
   ### theme
   dark

   ### language
   en

   ## Current TODOs
   - [ ] todo_a1b2c3: Review PR for auth module (due: 2026-03-01, people: Alice) [work]
     Check the error handling changes
   - [x] todo_d4e5f6: Buy groceries (due: 2026-02-25) [personal]
   ```
3. **Write-Through** — Tool mutations (set/remove/clear) update both the in-memory cache and persist to storage immediately
4. **Session Persistence** — `getState()`/`restoreState()` serialize/deserialize entries for session save/load

### User Info Tools

| Tool Call | Description | Permission |
|-----------|-------------|------------|
| `store_set("user_info", key, { value, description? })` | Store/update entry by key | Always allowed |
| `store_get("user_info", key?)` | Retrieve one entry by key, or all entries (key optional) | Always allowed |
| `store_delete("user_info", key)` | Remove a specific entry by key | Always allowed |
| `store_action("user_info", "clear", { confirm: true })` | Clear all entries | Requires approval |

### TODO Tools

TODOs are stored as user info entries with a `todo_` key prefix. They are rendered in a dedicated **"Current TODOs"** checklist section in context, separate from regular user info.

| Tool | Description | Permission |
|------|-------------|------------|
| `todo_add` | Create a TODO (`title`, `description?`, `people?`, `dueDate?`, `tags?`) | Always allowed |
| `todo_update` | Update a TODO — partial updates (`id`, `title?`, `description?`, `people?`, `dueDate?`, `tags?`, `status?`) | Always allowed |
| `todo_remove` | Delete a TODO by id | Always allowed |

**TODO fields:**
- `title` (required) — short description of the task
- `description` (optional) — additional details
- `people` (optional) — other people involved besides the current user
- `dueDate` (optional) — deadline in `YYYY-MM-DD` format
- `tags` (optional) — categorization tags (e.g. `["work", "urgent"]`)
- `status` — `'pending'` or `'done'`

**Agent behavior (built into plugin instructions):**
- **Proactive creation** — When conversation implies an action item, the agent suggests creating a TODO. Explicit requests like "remind me" or "track this" create one immediately.
- **Daily reminders** — Once per day, the agent reminds about overdue and soon-due items (within 2 days). Uses a `_todo_last_reminded` internal entry to avoid repeating.
- **Auto-cleanup** — Completed TODOs older than 48 hours are automatically removed. Pending TODOs overdue by more than 7 days prompt the user: "Still relevant or should I remove it?"

### Storage

- **Default path:** `~/.oneringai/users/<userId>/user_info.json` (defaults to `~/.oneringai/users/default/user_info.json`)
- **Custom storage:** Implement `IUserInfoStorage` and pass via config or `StorageRegistry`

```typescript
// Via StorageRegistry
StorageRegistry.set('userInfo', (context?: StorageContext) => {
  return new MongoUserInfoStorage(collection);
});
```

### Configuration

```typescript
interface UserInfoPluginConfig {
  storage?: IUserInfoStorage;    // Custom storage backend
  maxTotalSize?: number;         // Default: 100000 (~100KB)
  maxEntries?: number;           // Default: 100
  userId?: string;               // Auto-set from AgentContextNextGen._userId
}
```

### Differences from Other Plugins

| | PersistentInstructions | UserInfo | InContextMemory |
|---|---|---|---|
| **Scope** | Agent-scoped | User-scoped | Session only |
| **Storage key** | `agentId` | `userId` | None (in memory) |
| **Persists to disk** | Yes | Yes | No |
| **In system message** | Yes | Yes | Yes |
| **Value type** | `string` | `unknown` (any JSON) | `unknown` (any JSON) |

### Use Cases

- User preferences: theme, language, timezone, notification settings
- User context: role, location, department
- Accumulated knowledge about the user
- Profile information the LLM should always have access to
- TODO tracking: tasks with deadlines, involved people, and tags — with proactive reminders and auto-cleanup

> ⚠️ **Deprecated** in favour of the Self-Learning Memory plugin below. `UserInfoPluginNextGen` keeps working unchanged; the memory plugin supersedes it with append-only facts (history preserved via supersession), LLM-synthesised profiles that evolve with new observations, three-principal permissions, and semantic recall.

---
