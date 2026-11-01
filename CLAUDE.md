# Claude Code instructions

`AGENTS.md` is the canonical OneRingAI guide for every coding agent.

Before planning or changing OneRingAI code, read `./AGENTS.md` completely and
follow it. It contains the architecture invariants, integration recipes,
capability routing, documentation map, repository conventions, and validation
commands.

When OneRingAI is installed as a dependency rather than opened as its source
repository, read:

```text
node_modules/oneringai/AGENTS.md
```

Do not maintain a separate Claude-specific copy of the API guidance here. This
small file intentionally delegates to `AGENTS.md` so Codex, Claude Code, and
custom agents use the same source of truth.

The essential invariant is:

```text
named Connector -> Agent -> provider
                     |
                     +-> AgentContextNextGen plugins -> shared ToolManager
```

Use public package exports in consumer code, keep credentials in named
connectors, and verify uncertain APIs against `API_REFERENCE.md`, the relevant
specialist guide, and runnable examples.
