# memlab

Interactive lab for exercising the `@everworker/oneringai` memory subsystem end-to-end. Uses an in-memory adapter so every run starts clean (optional `/dump` + `/load` for persistence across restarts).

Four modes, all driven from a single REPL:

1. **`/chat`** — full read+write memory tools, no background ingestion. Agent sees 11 `memory_*` tools (5 read + 6 write, including `memory_set_agent_rule` for user-driven behavior directives like "be terse") and decides when to write. Good A/B baseline against `/chat-auto`. Type `/rules` at any point to list the current user-specific behavior rules.
2. **`/chat-auto`** — **division-of-labor** architecture. Agent still has all 11 tools, but the write plugin's instructions tell it to use writes ONLY for explicit user requests ("remind me to X", "create a task", "remember that Y", corrections, "be terse"/behavior rules). A separate `SessionIngestorPluginNextGen` runs after every turn on the cheaper `MEMLAB_EXTRACT_MODEL` and captures ambient facts from the conversation — it never writes agent-subject facts, so user-directive rules flow exclusively through the agent's explicit `memory_set_agent_rule` call and render into the system message's `## User-specific instructions for this agent` block on the next turn. After each turn memlab prints what the background pipeline extracted + ingest time, so you can see what the plugin learned on top of whatever the agent wrote in-turn. The post-turn summary splits `[agent writes: ...]` (ruled-based / in-turn agent tool calls) from `[ingestor: ...]` (background extraction) so origin is obvious. Type `/rules` at any time to list active rules; they're also listed at session start if any carried over.
3. **`/extract`** — paste any text (or a raw email with `From:` / `To:` headers) and run it through `SignalIngestor` + `ConnectorExtractor`. Prints resolved entities, written facts, merge candidates, and ingestion errors.
4. **`/browse`** — direct read-only queries against `MemorySystem`. List entities and facts with filters (predicate, subject, object, confidence, importance, text), inspect a single entity's profile + fact neighborhood, run semantic search (when an embedder is available), and list open tasks / recent topics.

## Setup

```bash
cd apps/memlab
cp .env.example .env
# edit .env — populate at least one API key
npm install
npm run dev
```

## Connector selection

On startup, memlab scans env vars and auto-registers a Connector for every vendor with a populated key. The first discovered vendor is "primary" and drives chat / extraction / profile generation. Override with `MEMLAB_PRIMARY=<connector-name>`.

Detection priority: OpenAI → Anthropic → Google → Groq → DeepSeek → Mistral → Together → Grok → Perplexity.

**Embeddings** (required for semantic search in `/browse`) are wired only if an OpenAI-family key is found. Without it, `search` in `/browse` is disabled; everything else still works.

## Main commands

```
/chat                 → chat with the memory-enabled agent
/extract              → paste text / email → extract facts
/browse               → direct memory queries
/who [<userId>]       show/set current userId (default: user-1)
/agent [<agentId>]    show/set current agentId (default: agent-1)
/status               show connectors, ids, counts
/reset                wipe in-memory store
/dump <file>          export memory to JSON
/load <file>          import memory from JSON (replaces current store)
/help
/exit
```

## `/browse` commands

```
entities [type=<type>] [limit=<N>]
entity <id>
facts [subject=<id>] [object=<id>] [predicate=<p>] [kind=atomic|document]
      [minConfidence=<0..1>] [minImportance=<0..1>]
      [text=<substring>] [limit=<N>]
search <query> [topK=<N>]      (requires embedder)
tasks [limit=<N>]
topics [days=<N>] [limit=<N>]
stats
help
/back
```

## Scripts

```
npm run dev        # tsx src/index.ts
npm run build      # tsup bundle to dist/
npm run typecheck  # tsc --noEmit
npm start          # run bundled dist/index.js
```

## Logs

Structured logs from the oneringai library (agent streams, provider calls, embedding calls, errors) are routed to a file so they don't garble the chat UI. Default:

```
apps/memlab/memlab.log
```

Path is shown in the startup banner. Tail in a second terminal while using memlab:

```
tail -f apps/memlab/memlab.log
```

Override with env vars:
- `LOG_FILE=/path/to/custom.log` (set to empty string to route back to console — not recommended while using `/chat`)
- `LOG_LEVEL=trace|debug|info|warn|error|silent` (default `info`)

## Notes

- In-memory store only. All data disappears on exit unless you `/dump` first.
- Agent stream events are rendered as: `agent>` prefix for text, `↪ tool ...` for tool start, `✓ / ✖` for tool result.
- `/extract` auto-detects whether the input looks like an email (headers on first line + blank separator). Email → `EmailSignalAdapter` (seeds from/to/cc + non-free sender/recipient domains). Otherwise → `PlainTextAdapter`.
