# Future consideration: tool priority hints

**Status:** deferred, not implemented.
**Date captured:** 2026-04-20

## Context

As of the memory read/write plugin split, agents using `MemoryWritePluginNextGen` side-by-side with connector tools (Google Calendar, Todoist, Jira, Notion, email, …) must decide at call time which tool to use for ambiguous user requests:

> "add to my calendar" — Google Calendar tool, or `memory_upsert_entity(type:'event')`?

Today the decision is taught only in prose (in the write plugin's instructions). The LLM is told "memory is a fallback, not first choice — prefer dedicated connector tools". This works, but it's prose-only: the LLM has to read the instruction block, identify all connector tools in its tool list, and cross-reference.

## Proposal (deferred)

Add an explicit priority hint to `ToolFunction`:

```ts
interface ToolFunction {
  definition: { ... };
  execute: (args, ctx) => Promise<...>;

  /**
   * Relative precedence when multiple tools plausibly match a user request.
   * Rendered into the system-message tool preamble so the LLM sees the
   * hierarchy at schema level, not just in prose.
   *
   *  'high'     — prefer strongly (e.g. a service-specific connector for the
   *               service the user named, like google_calendar_create_event).
   *  'normal'   — default.
   *  'fallback' — last resort when no more-specific tool exists (memory
   *               writes, generic file ops, etc.).
   *
   * Absent → 'normal'.
   */
  priorityHint?: 'high' | 'normal' | 'fallback';
}
```

Memory write tools would self-declare as `'fallback'`. Connector tools would stay `'normal'` (or be set to `'high'` per-service at registration time if a deployment wants an opinionated default).

The context builder would render a short preamble in the system message, something like:

```
Tool priority — when multiple tools match, prefer 'high' first, then 'normal',
then 'fallback'. Fallback tools (e.g. memory_*) are last-resort when no
more specific tool is available.
```

## Why it's deferred

1. **Prose-only works well enough for now.** The current write plugin instructions explicitly name connector categories (calendar, task, note-taking, email) and tell the LLM to prefer them. Until this shows up as a measurable failure mode, adding schema surface is premature.

2. **Priority semantics are subtle.** `'fallback'` is easy; `'high'` is not (what does "prefer google_calendar_* over outlook_*" mean if both are registered?). Getting it wrong would be worse than not having it.

3. **Cross-cutting change.** Every tool factory in the library would need to decide its priority. Churn on a large surface for marginal win.

4. **Testability gap.** Hard to write deterministic tests for "LLM correctly interprets priority hint" — benchmarks are real LLM calls, which we don't run in unit tests.

## When to revisit

- If telemetry (or user reports like the one that prompted this doc) shows agents with both memory-write and connector tools mis-routing user requests > N% of the time.
- If we add 10+ connector services to a single deployment and prose-only disambiguation breaks down.
- If a separate need arises for explicit tool-grouping or tool-preference (e.g. per-user tool preferences, user-selected "primary calendar service", etc.) — the priority field may naturally co-exist with that.

## Minimal change if we do implement

- Add `priorityHint` to `ToolFunction` in `src/domain/entities/Tool.ts`.
- Default memory write tools (in `createMemoryWriteTools`) to `'fallback'`.
- Render a short preamble in `AgentContextNextGen`'s tool-preamble block when any tool in the list declares a non-`'normal'` priority.
- Tests: schema-level assertion that memory writes carry `'fallback'`, prose check that the preamble renders when hints are present, and integration test with a mock two-tool choice (not trivial — may need LLM integration rather than unit).

## Related

- The current decision-principle prose lives in `MemoryWritePluginNextGen.WRITE_INSTRUCTIONS` (see `src/core/context-nextgen/plugins/MemoryWritePluginNextGen.ts`).
- If/when implemented, update that prose to reference the schema-level hint rather than carry the full rules inline.
