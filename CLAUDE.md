# Claude Code instructions

@AGENTS.md

The imported [AGENTS.md](AGENTS.md) is the canonical OneRingAI v2 API and
development guide. Keep this entry point thin so Claude, Codex and other coding
agents receive the same instructions. If imports are unavailable, read that file
before planning or changing code.

When consuming an installed package, read `node_modules/oneringai/AGENTS.md` and
its matching public API docs. Repository plans under `.claude/plans/` and local
auto-memory are historical context; verify API, package, branch, validation and
release claims against the current guide and source. Do not copy old v1 release
commands or assume a remembered failing test is still a valid baseline.

API guidance belongs in `AGENTS.md` and the linked specialist recipes, rather
than a separate Claude-specific API catalog. Do not import all specialist docs
here; read the relevant recipe when the task needs it.
