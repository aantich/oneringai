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
