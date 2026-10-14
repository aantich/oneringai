# AMOS - Advanced Multimodal Orchestration System

A powerful terminal-based AI assistant powered by `@everworker/oneringai`. Features multi-vendor support, runtime model switching, tool permissions, session management, and comprehensive context inspection.

> The historical name says “Multimodal,” but the current CLI implements text agents and tools only. Image, audio, and video commands are not implemented yet.

## Features

- **Multi-Vendor Support** - OpenAI, Anthropic, Google, Groq, Mistral, and more
- **Runtime Configuration** - Switch models, vendors, and prompts without restart
- **GPT-6 Astra** - Native reasoning controls, async tools, WebSocket steering, and safety alerts
- **Tool System** - Built-in developer tools + custom tool support
- **Permission System** - Granular control over tool execution
- **Session Management** - Save and resume conversations
- **Context Inspection** - Monitor token usage and context budget
- **Coding Agent Mode** - Autonomous coding with filesystem and shell access
- **Web Tools** - Native fetch plus connector-bound Serper search and ZenRows scraping
- **Extensible Commands** - Easy-to-add custom commands

## Quick Start

```bash
# Requires Node.js 22+

# Install dependencies
npm install

# Run in development mode
npm run dev

# Or production mode
npm run start
```

On first run, you'll be prompted to configure an API key.

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `/help` | | Show all commands |
| `/helpers [sub]` | `/helper` | Configure explicit helper models, invoke them and inspect purpose usage |
| `/model [name]` | `/m` | List or switch models |
| `/astra <sub>` | `/gpt6` | Use Astra and demonstrate its Responses APIs |
| `/vendor [name]` | | List or switch vendors |
| `/connector <sub>` | | Manage API keys (add, edit, delete) |
| `/prompt <sub>` | | Manage system prompts |
| `/tool <sub>` | | Manage tools (list, enable, disable) |
| `/external [sub]` | `/ext` | Manage external tools (search, scrape, fetch) |
| `/context [sub]` | `/ctx` | Context inspection (budget, breakdown, memory) |
| `/session <sub>` | | Session management (save, load, list) |
| `/config [sub]` | | View/edit configuration |
| `/status` | `/st` | Show current status |
| `/history [n]` | `/hist` | Show conversation history |
| `/clear` | `/cls` | Clear screen |
| `/exit` | `/q` | Exit AMOS |

## GPT-6 Astra

Fresh AMOS configurations default to `gpt-6-astra`. Existing configurations
keep their selected model; switch explicitly with:

```text
/astra use
/config set defaults.reasoningEffort high
```

AMOS omits `temperature` automatically for Astra and supports its five reasoning
efforts: `low`, `medium`, `high`, `xhigh`, and `max`.

The `/astra` command also provides focused, connector-first demonstrations of
the new Responses APIs:

```text
/astra ask Compare two rollout strategies
/astra reasoning high Now find the hardest failure modes
/astra async web_fetch Fetch https://example.com and summarize it
/astra live Draft a detailed migration plan
/astra steer Focus on rollback safety
/astra alert alert_123
```

`/astra async` executes the selected tool through AMOS's normal permission and
hook pipeline, then returns its result with the original `call_id`. `/astra live`
uses a text-only WebSocket session so the REPL remains available for steering.
The `ask`/`reasoning` continuation is separate from the managed chat session and
uses `previous_response_id` to preserve the stored prompt prefix.

Access to Astra is limited, and safety-alert retrieval requires the corresponding
OpenAI project permission. If your organization cannot use Astra yet, select a
different model with `/model gpt-5.6-terra`.

## Context Inspection

Monitor your context usage in real-time:

```
/context                 # Overview with utilization bar
/context budget          # Detailed token budget
/context breakdown       # Estimated tokens by component, including overhead
/context memory          # Working memory entries
```

Context budget and breakdown display the last prepared revision and label counts
as estimates rather than provider usage. Before any request is prepared, they show
an initial estimate. They do not trigger another compaction. For an offline recorded
demonstration, build the library and run `npm run example:amos-context` at the
repository root. Final managed budgets include fitting hook/request-event changes,
per-call model capacity and structured schemas. Auxiliary JSON repair keeps the
main prepared revision. The offline demonstration also shows the budget and
breakdown after known schema contributions select a smaller provider window.
No additional setting or command is needed. See [context preparation](../../docs/CONTEXT_PREPARATION.md).

Example output:
```
Context Overview
────────────────────────────────────
Utilization: ████████░░ 78% (warning)
Tokens: 45,600 / 108,800 available

Status: ⚠️  Warning - approaching limit
Mode: 💬 interactive
```

## Coding Agent Mode

Enable autonomous coding with full tool access:

```
/prompt use coding-agent
```

Features:
- File system tools (read, write, edit, glob, grep)
- Shell command execution
- Git-aware workflow
- Conversational plan/approval guidance for complex work

## Prompt Templates

Built-in prompts for different use cases:

| Prompt | Description |
|--------|-------------|
| `default` | General helpful assistant |
| `coding-assistant` | Expert coding assistant |
| `coding-agent` | Autonomous coding agent |
| `research-analyst` | Research and analysis |
| `writing-editor` | Writing and editing |

Use: `/prompt use coding-agent`

## Custom Tools

Add tools to `data/tools/`:

```javascript
// data/tools/my-tool.js
export default {
  definition: {
    type: 'function',
    function: {
      name: 'my_tool',
      description: 'What it does',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  execute: async (args) => ({ result: 'done' }),
  describeCall: (args) => 'description for logging',
};
```

Then run `/tool reload`.

## Data Directory

```
data/
├── config.json       # App configuration
├── connectors/       # API key configurations
├── sessions/         # Saved sessions
├── tools/            # Custom tools
├── prompts/          # System prompt templates
└── logs/             # Log files (dev mode)
```

Connector JSON files contain credentials in plaintext. Keep `data/connectors/` private and out of version control.

## Scripts

```bash
npm run dev          # Development (logs to file)
npm run dev:verbose  # Development with trace logging
npm run dev:console  # Development with console logging
npm run build        # Build for production
npm run start        # Run production build
npm run typecheck    # Type checking
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AMOS_DATA_DIR` | Data directory | `./data` |
| `LOG_FILE` | Log file path | `./data/logs/amos.log` |
| `LOG_LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, `silent` | `info` |

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** - Comprehensive usage documentation
- **[AGENTS.md](../../AGENTS.md)** - Developer documentation for AI assistants

## License

MIT


### Stage 02 tool outcomes

AMOS renders normalized tool failures accurately in streaming and non-streaming
runs. Cancellation/timeouts distinguish an unstarted tool from uncertain completion;
the app never claims that cancellation prevented an external write. A cancelled
run remains active until its wait settles. Existing app configuration and saved
sessions remain compatible; no new setting or command is required.

From the repository root, build the library and run
`npm run example:amos-tool-outcomes` for an offline rendering demonstration using
real local cooperative/noncooperative tool invocations. No credentials or external
services are used. See the [library guide](../../docs/TOOL_OUTCOMES_AND_CANCELLATION.md)
for supported cancellation paths and the separately opt-in live tests.

Stage 02 corrective validation also covers throwing background event observers,
early stream return, queued result scope changes, and connector clone/deadline handling.
These library fixes preserve AMOS's existing progress presentation; the offline outcome
example and adapter tests remain the app demonstration and validation.


## Helper models (Stage 06)

Helpers and task tracking are disabled in existing configurations. `/helpers`
shows configuration and explains extra requests before enabling a role. The main
agent model and its tool manager remain fixed. Configure accessible named connectors
with `/connector` first, then use active model IDs from the same vendor:

```text
/helpers
/helpers set extractor <connector-name> gpt-4o-mini
/helpers run extractor Extract the exact identifier ALPHA_6 into answer.
/helpers usage
/helpers set compactor <connector-name> gpt-4o-mini
/helpers compact
/helpers budget 6 3000000
/helpers off extractor
/helpers off
```

Use a matching model for each connector; `[effort]` is optional after the model and
must be supported. Setting a role makes no model requests. Explicit helper use can
make one extra request plus at most one JSON repair, with normal SDK retries also
charged to the budget. Selecting a compactor authorizes older conversation text
transfer to its connector. `/helpers compact` performs the existing explicit
rollover and preserves two recent turns; it can be a no-op with no helper call.
Automatic compaction remains algorithmic.

`/helpers usage` reports the current/latest task's purpose, connector/model,
validation, known token/cost subtotals and unknown/pending counts. Budget settings
apply separately to each operation, including normal agent runs; AMOS does not
share one task across independent commands. Token reservations use full provider
capacity and can exceed prompt estimates substantially. Ledger totals cover model
tokens including Google GenerateContent/Vertex thinking; public provider response
counts keep their legacy shape. Failed/cancelled streams retain any terminal usage
already received, and missing external counts remain unknown. Repeated helper
schema IDs are safe across commands. These review corrections use the existing
helper/usage commands and require no configuration migration. Cost estimates cover model
tokens, not external service fees. Configuration changes are blocked while the
runner is busy, preserve the session, and roll back if application fails. Old
configuration files/session state still load without enabling helpers. Static
profiles contain connector names, not credentials; runtime budget state is not
saved or restored. Full `/helpers off` disables tracking, while `off <role>` leaves
other roles and configured limits intact.

The [library recipe](../../docs/MODEL_TASKS_AND_HELPERS.md) documents all limits,
unsupported paths, ownership, data handling, cancellation and examples. Small
synthetic/live checks do not establish model quality or cost savings.

Run `npm run example:amos-helpers` from the repository root after building for a
deterministic walkthrough of the actual command and runner. It prints help, sets
an extractor, repairs a deliberate schema failure while preserving `ALPHA_6`,
displays both validation outcomes and disables helpers.
It uses synthetic responses/usage, writes no user configuration and cleans up its
runner and connector. Current output: [repair walkthrough](../../docs/evaluations/STAGE_06_SECOND_AMOS_OFFLINE.txt).
The [original transcript](../../docs/evaluations/STAGE_06_AMOS_OFFLINE.txt) remains historical evidence.


## Evidence inspection (Stage 03)

Evidence is disabled in existing configurations. To enable local file-backed
observations, add host settings to AMOS `config.json`, then reload the agent:

```json
{
  "evidence": {
    "enabled": true,
    "directory": "./data/evidence",
    "ownerId": "local-user",
    "namespace": "amos"
  }
}
```

Use a stable scope; separate host-owned owner/namespace values for different users
or tasks. Optional `retentionMs` sets expiry for new records. AMOS sets the agent's
userId from this explicit owner when enabling evidence. Evidence is local JSON,
with ordinary-restart acknowledgement, and is independent of session/scratch
cleanup. No model or tool argument can choose a different evidence scope.

- `/context evidence` lists at most 20 metadata records: ID, tool, execution status,
  completion, and effect classification. It does not print source contents.
- `/context evidence <id> [offset]` explicitly previews up to 1024 characters of
  stored record JSON, shows the next UTF-16 character offset, and handles missing,
  corrupt, or busy storage. The model's `evidence_list` can paginate beyond the
  first metadata page; `evidence_read` prefers scoped IDs, with full verified references also supported.
- The run view distinguishes evidence-storage/projection failure from successful
  tool execution. Cancellation with unknown completion remains unresolved; do not
  assume a write was prevented or repeat it to recreate a receipt.

Large tools project only if their authors supply `output.summarize`; unhinted
built-ins keep raw output. Projection defaults and recovery boundaries follow the
[library recipe](../../docs/DURABLE_EVIDENCE.md). No action replay or distributed
transaction machinery is added.

Bundled capture now inherits the file store's byte cap and stops oversized
serialization before expanding the full source. Mutable result hooks invalidate
stale projections, and invalid evidence snapshots leave the active context intact.
For hosts using native async tools, failed evidence pauses automatic continuation
and retains the completion for explicit recovery; status-only receipts cannot
release retained raw data. The [recovery example](../../examples/evidence-recovery.ts)
shows the library boundary without repeating an action. AMOS inspection commands
and persisted settings keep their existing interface.

Explicit AMOS session saves retain pending unacknowledged observations after an
interrupted run. Loading/saving again preserves the original source and invocation
without running the tool again. The runner regression exercises this with a real
file session backend and synthetic storage/model failures. Protected pending groups
also survive subsequent input and async insertion; recovery remains host-driven.
Closing AMOS streaming after a tool completion also retains the unstored source
for explicit session saving. The real runner regression covers closing, saving,
loading and saving again with one local action. Receipt-only recovery stays
protected; checkpoint restoration handles changed acknowledgement metadata.

After building from the repository root, `npm run example:amos-evidence` uses the
real command/runner with a synthetic provider and temporary storage. It verifies
metadata-only listing and an explicit bounded preview without credentials, network
calls, or changes to user configuration.
