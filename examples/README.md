# OneRingAI examples

This directory contains runnable TypeScript programs covering agents, tools,
streaming, media, connectors, OAuth, search, and MCP. Most examples import the
repository source directly; the context-freshness example imports the built package
and requires `npm run build`. Run examples from the repository root after installing
dependencies.

Most AI and search examples make real, billable API calls. Review the prompt,
model, and enabled tools before running them with production credentials.

## Setup

```bash
npm install
cp .env.example .env
npm run examples:check
```

Use Node.js 22 or newer. Add only the credentials needed by the program you want
to run, then use its command below. `npm run examples:check` type-checks every
example without making network calls.

## Environment variables

| Capability | Variables |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Google AI | `GOOGLE_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Together AI | `TOGETHER_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY`; optional `DEEPSEEK_HOST` and `DEEPSEEK_BASE_URL` |
| xAI | `XAI_API_KEY` (legacy `GROK_API_KEY` is also accepted) |
| Search | `SERPER_API_KEY` or `SERPER_KEY`; optionally `BRAVE_API_KEY`, `RAPIDAPI_KEY`, and `SERPER_API_KEY_BACKUP` |
| OAuth demos | Provider-specific client IDs/secrets as noted in the program; `OAUTH_ENCRYPTION_KEY` is recommended for persistent production storage |
| Remote MCP | `MCP_SERVER_URL`, optional `MCP_SERVER_TOKEN`, plus `OPENAI_API_KEY` |
| Logging | Optional `LOG_LEVEL`, `LOG_FILE`, and `LOG_PRETTY` |

## Agent Runtime

The Agent Runtime example executes either a native OneRingAI agent or an OpenAI
Codex SDK agent through the same specification/session/run workflow. It demonstrates
model and reasoning selection, observable autonomous execution, explicit local policy,
capability-aware behavior, and teardown. Start with the
[detailed guide](../USER_GUIDE.md#agent-runtime-preview) and use the
[design document](../docs/designs/AGENT_RUNTIME.md) for architecture and server plans.

| Program | What it shows | Requirements and how to run |
|---|---|---|
| [`agent-runtime-local.ts`](./agent-runtime-local.ts) | Interchangeable local OneRingAI/Codex SDK drivers with generic model/reasoning controls, live autonomous reasoning/activity events, explicit policy, and Codex workspace sandboxing. | `OPENAI_API_KEY`; `npx tsx examples/agent-runtime-local.ts oneringai` or `npx tsx examples/agent-runtime-local.ts codex` |

## Purpose-specific models and shared budgets (Stage 06)

Both programs use public package exports and require `npm run build`. Their default
mode is deterministic and offline; mock answers/usage establish plumbing, not model
quality or savings. See the [recipe](../docs/MODEL_TASKS_AND_HELPERS.md).

| Program | What it shows | Run and expected behavior |
| --- | --- | --- |
| [`purpose-specific-models.ts`](./purpose-specific-models.ts) | Explicit extract/main/verify with separate windows, a fixed main model and shared task. | `npm run example:purpose-models`: four records including a controlled schema repair that must retain `ALPHA_6`; main/verification then succeed. `npm run example:purpose-models -- --live`: billable `gpt-4.1` main plus `gpt-4o-mini` helpers, `OPENAI_API_KEY` from `.env`. At least three model requests, repairs/retries may add requests. Cleans up owned connectors, agent and task even on failure. |
| [`shared-run-budget.ts`](./shared-run-budget.ts) | Concurrent reservation denial, known-usage refund, idempotent external usage and unknown-price admission failure. | `npm run example:shared-budget`: rejects an overlapping request before dispatch, reports known synthetic totals and explicit unknown cost; destroys tasks. No credentials or external effects. |

`npm run test:models:live` explicitly makes billable OpenAI/Anthropic/Google calls
using all three `.env` keys. It checks helper/main run and stream, cross-provider
explicit rollover and controlled structured repair, plus thinking-enabled Google
run/stream accounting and an Anthropic fixed-budget extended-thinking helper
(14 live cases, including three controlled evidence-preserving helper repairs). These are functional marker
checks, not a quality benchmark. AMOS command examples are in its
[helper guide](../apps/amos/README.md#helper-models-stage-06).

## Text, agents, tools, and infrastructure

| Program | What it shows | Requirements and how to run |
|---|---|---|
| [`simple-text.ts`](./simple-text.ts) | Plain text generation, per-call settings, and JSON Schema structured output through the connector-first API. | `OPENAI_API_KEY`; `npx tsx examples/simple-text.ts` |
| [`simple-text-streaming.ts`](./simple-text-streaming.ts) | The same streaming pattern across every configured OpenAI, Anthropic, and Google connector. Missing providers are skipped. | At least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY`; `npx tsx examples/simple-text-streaming.ts` |
| [`basic-agent.ts`](./basic-agent.ts) | An agent using custom weather and restricted arithmetic tools, including the agentic tool-call loop. | `OPENAI_API_KEY`; `npm run example:agent` |
| [`multi-turn-conversation.ts`](./multi-turn-conversation.ts) | Explicit conversation history with `runDirect()`, useful when the application—not `AgentContextNextGen`—owns the transcript. | `OPENAI_API_KEY`; `npm run example:conversation` |
| [`interactive-chat.ts`](./interactive-chat.ts) | Interactive multi-provider chat, streaming, vision URLs/files, clipboard images, provider switching, Microsoft Graph access when configured, and approval-gated JavaScript execution. Type `/help` for commands and `/exit` to quit. | At least one supported provider key; `npm run example:chat` |
| [`multi-provider-comparison.ts`](./multi-provider-comparison.ts) | Sends one prompt through every configured OpenAI, Anthropic, Google, Groq, Together, DeepSeek, and xAI connector using one API shape. | At least one provider key; `npm run example:providers` |
| [`deepseek-agent.ts`](./deepseek-agent.ts) | Current V4 model, dedicated adapter, host preset selection, reasoning, and JSON Schema output. | `DEEPSEEK_API_KEY`; `npx tsx examples/deepseek-agent.ts` |
| [`json-manipulation-tool.ts`](./json-manipulation-tool.ts) | Agent-driven JSON add/replace/delete operations plus deterministic chaining of multiple `json_manipulate` calls. | `OPENAI_API_KEY`; `npm run example:json-tool` |
| [`agent-with-hooks.ts`](./agent-with-hooks.ts) | Execution hooks, simulated approval, tool-result caching, metrics, and pause/resume control. | `OPENAI_API_KEY`; `npm run example:hooks` |
| [`logging-demo.ts`](./logging-demo.ts) | Logger configuration and structured logs emitted by an agent and a custom calculation tool. | `OPENAI_API_KEY`; `npm run example:logging` |
| [`custom-infrastructure.ts`](./custom-infrastructure.ts) | Skeleton implementations of `ITextProvider`, `ITokenStorage`, and `IToolExecutor`, plus injecting a custom provider into an agent. It uses local smoke tests rather than calling the hypothetical service. | No credential required; `npm run example:custom-infrastructure` |
| [`agentic-evaluation-baseline.ts`](./agentic-evaluation-baseline.ts) | Four Stage 00 workloads using the real Agent loop, strict offline replay, evidence-based completion, cancellation/checkpoint/continuation, correlated event reports, and optional actual LLM runs. See the [evaluation guide](../docs/AGENTIC_BASELINE_EVALUATION.md). | Offline: no credentials, `npm run example:agentic-baseline`; held-out: append `-- --held-out`; real OpenAI calls: append `-- --live`. Other live providers require explicit vendor/model configuration. |
| [`context-request-budget.ts`](./context-request-budget.ts) | Known JSON schema and custom provider window trigger one compaction; separate colliding spills recover both sources; an oversized protected error fails before dispatch. | Build first, then `npm run example:context-budget`. No credentials or network; expects one fitting model call, both recovered markers, and `CONTEXT_OVERFLOW` for the oversized error. Agents, contexts, and the fixture connector are destroyed/removed. |
| [`provider-config-generator.ts`](./provider-config-generator.ts) | An interactive AI assistant that asks business-level questions and generates an OAuth connector configuration. Choosing to save writes `oauth-<name>-config.json` in the current directory. | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; `npm run example:provider-config` |
| [`provider-config-programmatic.ts`](./provider-config-programmatic.ts) | Non-interactive `ProviderConfigAgent` use, including multi-turn generation of GitHub and Microsoft connector configurations. | `OPENAI_API_KEY`; `npx tsx examples/provider-config-programmatic.ts` |

The interactive chat can execute JavaScript and read user-selected local images.
Its tool calls require approval. The focused Google tool tests below deliberately
use `autoApproveAll` to remain non-interactive; keep that setting confined to
trusted demo tools.

## Streaming, vision, audio, and provider checks

| Program | What it shows | Requirements and how to run |
|---|---|---|
| [`vision-image-input.ts`](./vision-image-input.ts) | Single-image analysis, image comparison, explicit multimodal history, and low-detail image input. It uses public Unsplash URLs. | `OPENAI_API_KEY`; `npm run example:vision` |
| [`audio-demo.ts`](./audio-demo.ts) | OpenAI TTS, STT with timestamps, capability inspection, and an STT → agent → TTS voice pipeline. It writes `tts-output.mp3`, `user-input.mp3`, and `agent-response.mp3` in the current directory. | `OPENAI_API_KEY`; `npx tsx examples/audio-demo.ts` |
| [`openai-realtime.ts`](./openai-realtime.ts) | A server-side Realtime WebSocket session, streamed audio/transcript collection, and minting a short-lived browser client secret without printing the secret. | `OPENAI_API_KEY`; `npm run example:realtime` |
| [`test-openai-streaming.ts`](./test-openai-streaming.ts) | OpenAI streaming event types and final usage accounting. | `OPENAI_API_KEY`; `npx tsx examples/test-openai-streaming.ts` |
| [`test-anthropic-streaming.ts`](./test-anthropic-streaming.ts) | Anthropic streaming event types and final usage accounting. | `ANTHROPIC_API_KEY`; `npx tsx examples/test-anthropic-streaming.ts` |
| [`debug-google-tools.ts`](./debug-google-tools.ts) | A compact diagnostic that verifies Gemini can call and execute `execute_javascript`. | `GOOGLE_API_KEY`; `npx tsx examples/debug-google-tools.ts` |
| [`test-google-simple.ts`](./test-google-simple.ts) | Non-streaming Gemini tool-call, iteration, and completion events. | `GOOGLE_API_KEY`; `npx tsx examples/test-google-simple.ts` |
| [`test-google-streaming.ts`](./test-google-streaming.ts) | Gemini streaming across a complete tool lifecycle, with assertions for call, execution, and final usage events. | `GOOGLE_API_KEY`; `npx tsx examples/test-google-streaming.ts` |
| [`test-google-weather.ts`](./test-google-weather.ts) | Automatic versus explicitly requested Gemini tool use with a deterministic custom weather tool. | `GOOGLE_API_KEY`; `npx tsx examples/test-google-weather.ts` |

## Search, connectors, and OAuth

| Program | What it shows | Requirements and how to run |
|---|---|---|
| [`search-connector-demo.ts`](./search-connector-demo.ts) | Direct connector-backed search with correct vendor authentication headers, optional RapidAPI search, and named Serper-key failover. | At least one search key; `npx tsx examples/search-connector-demo.ts` |
| [`web-research-agent.ts`](./web-research-agent.ts) | An agent combining connector-discovered web search, `web_fetch`, and JSON manipulation for a multi-source research task. | `OPENAI_API_KEY`; a Serper key enables the search sections; `npm run example:web` |
| [`oauth-demo.ts`](./oauth-demo.ts) | Real `OAuthManager` client-credentials caching, encrypted `FileStorage`, and authorization-code PKCE URL generation against a deterministic local token server. Temporary files are removed. | No external credential required; `npm run example:oauth` |
| [`oauth-registry-demo.ts`](./oauth-registry-demo.ts) | Registering several OAuth connectors, inspecting the registry, discovering connector-bound tools, and wiring those tools to an agent. It does not complete browser OAuth or call the registered services. | Credentials are optional for the registry demo; `OPENAI_API_KEY` enables agent construction; `npm run example:oauth-registry` |
| [`oauth-static-tokens.ts`](./oauth-static-tokens.ts) | Mixing API-key and OAuth connectors, authenticated fetch, connector tool discovery, and agent wiring. With a real OpenAI key it verifies `/models`; placeholder connectors are not called. | Credentials optional, though `OPENAI_API_KEY` enables live verification; `npm run example:oauth-static` |
| [`oauth-multi-user.ts`](./oauth-multi-user.ts) | Multi-user token isolation, auth URL generation, storage patterns, and production architecture guidance. It uses a temporary encrypted token directory and does not launch a browser. | OAuth client values are optional for this pattern demo; `npm run example:oauth-multi-user` |
| [`oauth-multi-user-fetch.ts`](./oauth-multi-user-fetch.ts) | Binding `createAuthenticatedFetch()` to individual users and applying that pattern in request handlers, jobs, and agents. It does not call GitHub without completed user OAuth. | OAuth client values are optional for this pattern demo; `npm run example:oauth-multi-user-fetch` |

## MCP

The stdio examples launch [`demo-server.ts`](./mcp/demo-server.ts), which exposes
only synthetic in-memory files, a resource, and a prompt. They do not grant a
child process access to the repository filesystem.

| Program | What it shows | Requirements and how to run |
|---|---|---|
| [`mcp/basic-client.ts`](./mcp/basic-client.ts) | Connect to a local stdio MCP server, discover its tools, register them on an agent, and use one in an LLM turn. | `OPENAI_API_KEY`; `npx tsx examples/mcp/basic-client.ts` |
| [`mcp/resources.ts`](./mcp/resources.ts) | List/read MCP resources and list/get prompt templates without an LLM call. | No credential required; `npx tsx examples/mcp/resources.ts` |
| [`mcp/multi-server.ts`](./mcp/multi-server.ts) | Create two namespaced stdio clients from a typed `MCPConfiguration`, connect all, and expose both tool sets to one agent. | `OPENAI_API_KEY`; `npx tsx examples/mcp/multi-server.ts` |
| [`mcp/http-client.ts`](./mcp/http-client.ts) | Connect to an existing Streamable HTTP MCP endpoint, inspect capabilities, register remote tools, and let an agent use them. It exits cleanly with setup guidance when no URL is configured. | `OPENAI_API_KEY`, `MCP_SERVER_URL`, optional `MCP_SERVER_TOKEN`; `npx tsx examples/mcp/http-client.ts` |
| [`mcp/demo-server.ts`](./mcp/demo-server.ts) | The safe local stdio fixture used by the other MCP examples; accepts optional `--label <name>` to distinguish instances. Normally launch it through a client. | No credential required; manual server command: `node --import tsx examples/mcp/demo-server.ts --label demo` |

## Troubleshooting

- A missing variable causes most examples to fail early with the exact variable
  name. Add it to `.env` and rerun.
- A provider can retire a model or reject an expired credential independently of
  the library. The comparison and focused provider checks identify which provider
  failed.
- `oauth-demo.ts` binds an ephemeral loopback port. Run it in an environment that
  permits local listeners.
- `mcp/http-client.ts` needs a separately running Streamable HTTP MCP server; the
  repository only supplies the stdio demo server.
- Delete the three generated MP3 files when you no longer need the audio demo
  output.

### Context freshness (Stage 01)

The context example retrieves native evidence connected to a spilled message
result. `npm run example:structured-budget` runs
[`structured-output-budget.ts`](./structured-output-budget.ts) after the build,
using an injected offline provider: the fitting repair makes two calls and
returns `{ "value": "Done" }`; the oversized repair raises `CONTEXT_OVERFLOW`
before a second call. It preserves the main prepared revision and cleans up its
agents/connectors. No keys, network, or external services are needed.

After `npm run build`, run `npm run example:context-freshness` for the offline
[compaction demonstration](./context-compaction-freshness.ts). It shows a refreshed
working-memory index, retained pending tool dependencies, and the final estimated
budget. It also contrasts a keyless notes lookup (index metadata only) with a keyed
lookup that recovers the original source contents. `npm run example:amos-context` renders the real AMOS budget/breakdown commands
without credentials. See [context preparation](../docs/CONTEXT_PREPARATION.md) for
contracts, failure behavior, and the opt-in billable `npm run test:context:live` suite.


### Tool outcomes and cancellation (Stage 02)

After `npm run build`, run `npm run example:tool-outcomes` for
[`tool-outcomes-and-cancellation.ts`](./tool-outcomes-and-cancellation.ts). No keys
are required. It demonstrates preserved domain/failure payloads, cooperative and
noncooperative deadlines, a correctly correlated late success, and host cancellation
during a loopback HTTP body read. The server binds an ephemeral localhost port;
there are no external service calls or writes. Managers, connector, and server are
cleaned up. Expect unknown completion at the timeout and a separate late diagnostic.

`npm run example:amos-tool-outcomes` renders these real local outcomes through
AMOS, including an explicit warning that a timed-out operation may still finish.
`npm run test:tools:live` is a separate, billable opt-in check using `.env` OpenAI,
Anthropic, and Google credentials with local tools. Missing or rejected credentials
fail the selected provider check. See the [guide](../docs/TOOL_OUTCOMES_AND_CANCELLATION.md)
and [corrective validation record](../docs/evaluations/STAGE_02_CORRECTIONS_VALIDATION.json).

Stage 02's `tool-outcomes-and-cancellation.ts` also demonstrates invocation selection:
an admitted call retains its original implementation during a plugin wait, and the next
call uses the replacement registration. Run after building; setup requires no keys.
The example destroys its manager and closes its local HTTP server.

With `ANTHROPIC_API_KEY` in `.env`, opt in to
`npm run example:tool-outcomes -- --live-anthropic`. After the offline demonstrations,
it makes billable Anthropic calls in both `run()` and `stream()` modes using a named
connector and in-place `before:llm` options. Expect `domain_probe=succeeded` followed
by `failure_probe=failed` in each mode, with both original markers recovered.
Agents and the example-owned connector are cleaned up. The library narrows explicit
Anthropic named-tool requests and rejects mismatched provider calls before local
execution; see the [selection contract](../docs/TOOL_OUTCOMES_AND_CANCELLATION.md#explicit-anthropic-tool-selection).


## Durable evidence (Stage 03, development branch)

Build the library first. These examples need no credentials or network and clean
all temporary resources:

- `npm run example:durable-evidence` — [durable-tool-evidence.ts](./durable-tool-evidence.ts)
  projects a 92 KB synthetic result, preserves status/IDs, evicts scratch, rolls
  over history, restores a saved context, and verifies exact recovery in a separate
  Node process. Output labels ordinary-restart acknowledgement explicitly.
- `npm run example:ambiguous-evidence` — [ambiguous-action-evidence.ts](./ambiguous-action-evidence.ts)
  simulates one write whose response never arrives. Cancellation records unknown
  completion without repeating the action; storage is explicitly process-local.
- `npm run example:evidence-recovery` — [evidence-recovery.ts](./evidence-recovery.ts)
  retains a successful local action's observation during a storage outage, rejects
  receipt-only acknowledgement, repairs storage, and permits rollover after exact
  result recovery. Pending delivery-only results survive file session save/load;
  the optional outcome is omitted deliberately. The action executes once; a custom backend uses an explicit
  serialization budget and requires no new adapter methods.
- `npm run example:evidence-interruption` — [evidence-stream-interruption.ts](./evidence-stream-interruption.ts)
  closes a synthetic stream at tool completion, saves the unstored observation,
  rejects receipt-only admission, then restores a checkpoint after acknowledgement
  and recovers exact data. One tool action and one synthetic model call; no keys
  or network. Temporary session files are cleaned; evidence is process-local.
- `npm run example:amos-evidence` — exercises the real AMOS runner and `/context evidence`
  command with a synthetic provider. Lists metadata and explicitly previews at most
  1024 characters, showing the next offset.

`npm run test:evidence:live` is separately opt-in and billable, using `.env`
OpenAI/Anthropic/Google credentials with local synthetic tools. It verifies managed
run/stream source retrieval and raw fallback after a controlled storage failure.
Read [setup, bounds, failure recovery and durability](../docs/DURABLE_EVIDENCE.md).

### Context strategies (Stage 07)

After building, run `npm run example:context-strategies` or add `-- --held-out`
for the six retained synthetic regression variants sharing one lookup scaffold.
The CLI also demonstrates three fitting critical preparations with a full evidence
store, unchanged history and zero source writes/helper calls under each new policy.
Algorithmic, masking and summaries
use the same local read-only environment; a common bounded reader retrieves source
fields by evidence ID or exact working-memory key. Offline providers and usage are
scripted. Expected: exact answer/account/status, no repeated action, all completion
predicates pass. Owned agents/connectors are destroyed and evidence is process-local.

`npm run example:context-strategies -- --live --held-out` loads `.env` and makes
billable OpenAI `gpt-4o` main / `gpt-4o-mini` helper calls, two repetitions per task
and strategy in seeded shuffled order. Set `CONTEXT_STRATEGY_REPORT_PATH` to save
actual usage, helper/repair attempts, returned models, source reads, failures and
latency. No external writes. This is a bounded functional pilot, not statistical
proof of non-inferiority or general cost reduction. Both new strategies remain
experimental and opt-in; algorithmic stays the default.

`npm run example:amos-context-strategies` uses the actual AMOS runner/command with
synthetic responses, a local file evidence store and temporary persisted settings.
It demonstrates real masking, diagnostics and policy switching without recreating
the agent or repeating its original read. Actual ConfigManager also demonstrates
failed selection restoring an absent setting through a later unrelated save/reload.
Selection and rollback make no model call; files, agent and connector are cleaned up. No keys/network are required. Read the
[complete recipe](../docs/CONTEXT_STRATEGIES.md) for setup and support boundaries.


## Protected task-state workflow

After `npm run build`, run `npm run example:task-state`
([task-state-workflow.ts](./task-state-workflow.ts)). No keys or network are needed.
It keeps a host correction and unconfirmed proposal distinct, records one simulated
accepted action, suspends through rollover/checkpoint/restart, verifies recovery
in a separate Node process, then records host-confirmed remote completion. Expected:
one submission, corrected 40 EUR constraint, preserved pending state, and no LLM calls.
Temporary session/evidence files are removed.

`npm run example:amos-task-state` uses the actual AMOS runner and `/context task`
commands with one synthetic provider call. It demonstrates validated edits, stale
revision rejection, session reload and model command text remaining data.
`npm run test:task-state:live` explicitly makes billable OpenAI/Anthropic/Google
synthetic run/stream/restart and extractor calls using `.env`. Read
[Task State](../docs/TASK_STATE.md) for host authority, capacities and limitations.


The Stage 04 corrective walkthrough also reclaims old notes, reuses a pruned ID and
checks a second file checkpoint without another submission. The actual AMOS
walkthrough fills 100 task records, displays an actionable capacity error, uses
`resolve-prune`, adds a constraint and verifies checkpoint recovery with one total
synthetic provider call. The live task-state probes additionally validate ID reuse
and explicit atomic host recovery after their model response, without additional
model/action calls. No real remote completion or fresh quality benchmark is claimed.

The second corrective pass preserves legacy resolved-feature and external-plugin
configuration types. After building, `npm run test:agentic:compat` compiles pinned
legacy consumers through the root and `/types` exports without spreading current
defaults. Both task-state walkthroughs remain applicable and pass unchanged.

### Bounded recovery and completion (Stage 10)

Build the library first. These examples are offline and require no `.env` keys:

| Command | Behavior |
| --- | --- |
| `npm run example:feedback-agent` | Rejects premature completion, recovers one transient read failure, then verifies host artifact/receipt state within four synthetic calls and two shared recovery attempts. |
| `npm run example:loop-equivalence` | Compares run/stream semantic hook and blocking-tool traces, recovery and completion, then proves stopped calls/receipts survive new input, including run-only JSON formatting. |
| `npm run example:amos-loop` | Uses the actual AMOS runner and `/context loop`, a blocked checkpoint and fresh class-method/private-state host verification. |

All examples destroy agents/connectors; the AMOS example removes its temporary
session directory. `examples/agent-loop/scripted-provider.ts` is a deterministic
model simulation that throws if its script is exhausted, not a production provider.
Hard ModelTask bounds use its explicit single-attempt host attestation.
`npm run test:loop:live` explicitly opts into real billable OpenAI, Anthropic and
Google run/stream recovery/blocked and stopped-history/formatting checks using `.env`. Tools are synthetic reads;
there are no real external writes. Read [Loop Policies](../docs/AGENT_LOOP_POLICIES.md)
for defaults, uncertainty, persistence and intentional run/stream differences.


The offline `purpose-specific-models.ts` example now starts with a shape-valid
empty answer and uses optional `validationSchema` to require content. Its one
existing repair retains the exact source marker and shares task accounting.
The structured-compaction live gate additionally injects the recorded empty
Google summary after a real call, then requires a real Google repair, source
retrieval and exact final constraints without masking fallback. All fault
injection is labeled in the report and uses synthetic source data.

### Stage 12: opt-in presets and capability inspection

Build first, then `npm run example:agentic-presets` runs
[`agentic-presets.ts`](agentic-presets.ts) without keys/network: plain Agent,
research/workflow compositions, explicit host evidence scope, workflow completion
override, resolved settings and unavailable-feature diagnostics. It verifies call
counts, accepts getter-backed host scopes, demonstrates a rejected shared resume
retaining blocked-tool authority/checkpoint A and JSON-converting plugin recovery,
and destroys all agents/contexts and temporary files. `npm run example:amos-presets` runs the AMOS
selection/persistence/inspection walkthrough, verifies rejected-load checkpoint
protection and removes temporary files.
`npm run test:presets:live` is a separate billable OpenAI/Anthropic/Google gate
using `.env`; it also verifies original-history continuation after the three session
recovery paths on every provider. No external writes. See the [recipe](../docs/AGENT_PRESETS.md).

The Stage 12 AMOS preset walkthrough also demonstrates candidate-first handoff,
failed-candidate preservation, and title retention across named/unnamed saves.
The actual app/session command and timer-backed autosave paths are covered by
[latest corrective validation](../docs/evaluations/STAGE_12_THIRD_CORRECTIONS.json).


### Stage 05: selective context and cache-aware layout

Build first. `npm run example:context-selection` compares an overflowing legacy
whiteboard/source view with budgeted selection, retaining the exact stored entries
and printing selection reasons, exact omitted-source recovery and stale-account
admission rejection. `npm run example:context-dispatch-safety` demonstrates one
bounded refresh for hook-edited input, rejection of superseded-prompt JSON repair
and last-request wrap-up accounting using local scripted providers. It also
formats before a real default algorithmic spill and persists one coherent structured
suspension without repeating its local action. Its checkpoint is process-local and
its temporary correlation file is removed during cleanup; no restart durability is
implied. Expected output includes formattingBeforeSpill and structuredSuspension.
`npm run example:cache-aware-context` demonstrates
stable instruction prefixes with late dynamic data and unknown provider counters.
`npm run example:amos-context-selection` executes the real AMOS runner and breakdown,
including a forced local read/wrap-up, then destroys its Agent and removes temporary
files. All four default to offline and label synthetic usage explicitly.

`npm run test:context-assembly:live` explicitly bills OpenAI/Anthropic/Google calls
using `.env`, checks run/stream in both layouts with local reads, and reports actual
cache usage without requiring hits. It also checks final hook edits, ordinary/stale
JSON repair and actual per-request wrap-up accounting. `STAGE05_PROVIDER=openai|anthropic|google npm run
example:cache-aware-context -- --live` runs a separate two-call provider observation.
No service writes or general cache/cost/quality claim. See [setup and boundaries](../docs/CONTEXT_ASSEMBLY.md).

## Plugin/native compaction (Stage 16A)

Build first; all five default programs are offline protocol fixtures, with cleanup
of owned agents/connectors/tasks and temporary files. They do not measure LLM quality.

| Program | Run / expected behavior |
| --- | --- |
| [`native-context-compaction.ts`](./native-context-compaction.ts) | `npm run example:native-compaction`: independent targets, preserved plugins, counted native window, early server-token rejection without a model call/history swap, and main continuation. Optional `-- --live=openai`/`anthropic` uses `.env`, max eight generation attempts and main-only output caps. |
| [`native-context-hooks.ts`](./native-context-hooks.ts) | `npm run example:native-hooks` (automatic) or `npm run example:native-hooks-manual` (explicit with automatic disabled): preserve a critical whiteboard fact in `beforeCompaction`, refresh once, reduce history and continue. Offline default; add `-- --live=openai`/`anthropic`, with eight-attempt/150-second task bound and cleanup. Manual Anthropic mode uses an 8192-token fixed-thinking budget and a compatible main output cap. |
| [`native-context-recovery.ts`](./native-context-recovery.ts) | `npm run example:native-recovery`: repeat compaction, durable source/session files, separate-process streamed resume, rejected model change and trusted pre-native recovery. Same opt-in live flags; parent/child each have call/deadline bounds. |
| [`native-context-comparison.ts`](./native-context-comparison.ts) | `npm run example:native-comparison`: one fixed held-out task across algorithmic/masking/structured/native, exact answer/constraint/no-repeat predicates and known/unknown usage. `-- --live` uses OpenAI `gpt-6-astra` plus a `gpt-4o-mini` summary helper; six attempts per policy. |
| [`AMOS native walkthrough`](../apps/amos/examples/native-compaction-offline.ts) | `npm run example:amos-native-compaction`: real adapter/configuration/commands, protected/empty result and saved-session resume. No keys. |

Selected live native models are `gpt-6-astra` and `claude-sonnet-4-6`. Native
callability does not guarantee reduction. Sources stay scoped; never repeat a write
to repair context. See the [native recipe](../docs/NATIVE_CONTEXT_COMPACTION.md) for
limits and actual adoption guidance.


## Managed model routing (Stage 14A)

Build first. These default programs are offline, require no credentials, assert
their functional contracts and clean up owned agents/connectors/tasks/temp files.

| Example | Command and expected behavior |
| --- | --- |
| [adaptive-model-routing.ts](./adaptive-model-routing.ts) | `npm run example:model-routing`: host category selection, shared-task phase continuity, explicit default stream and opt-out; routes `fast,fast,default,default,default`. Prints decisions and actual/synthetic task accounting. |
| [routing-with-context.ts](./routing-with-context.ts) | `npm run example:routing-context`: memory/evidence plus synthetic native history on an explicitly permitted alternative whose unused default has no native adapter; protected incompatible switch and compatible continuation. |
| [routing-suspension-recovery.ts](./routing-suspension-recovery.ts) | `npm run example:routing-suspension`: synthetic wait, ordinary event resumption, inherited JSON format, bounded malformed-output repair and host completion on the original route/task. Four model calls, one wait, one resumed completion check. |
| [Failed suspension finalization](./routing-suspension-recovery.ts) | `npm run example:routing-suspension -- --failed-finalization`: two-call cap denies formatting and two event retries under the original task; one registered wait, zero successful suspension events, saved failed-finalization receipt. Explicit host cancellation releases task authority without undoing the wait. |
| [AMOS routing](../apps/amos/examples/routing-offline.ts) | `npm run example:amos-routing`: real `/routing` commands, persisted JSON rules/hints, actual run/stream decisions and opt-out. |

`npm run example:model-routing -- --live=openai` (or `anthropic`/`google`) loads
`.env`, requires that provider key and makes at most eight generation attempts
within 120 seconds. `npm run test:model-routing:live` bills the complete routing
contract suite and small fixed quality/cost pilot across all three providers.
Synthetic usage makes no quality/cost claim; the real pilot is not a general
benchmark. See the [recipe](../docs/MODEL_ROUTING.md) for setup, model fixtures,
limits, native ownership, failure semantics and validation evidence.

The Google pilot explicitly disables thinking on supported Gemini 2.5 Flash
GenerateContent models. The converter now sends the required zero budget; the
original exact-answer and minimum savings checks are unchanged. This is a measured
fixture comparison rather than a promise that every routed workload costs less.
