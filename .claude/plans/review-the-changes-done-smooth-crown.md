# Review: uncommitted changes on `task-event-lifecycle`

## Context

Branch `task-event-lifecycle` has uncommitted work that adds:

- `MemorySystem.upsertEntity` — optional `metadataMerge` (`fillMissing` | `overwrite`) + `metadataMergeKeys` whitelist for the identifier-resolved path. Default behaviour is preserved (metadata ignored on resolve).
- `MemorySystem.resolveRelatedItems(entityIds, scope, opts)` — multi-entity public traversal returning tasks + events with `matchedEntityId` attribution.
- `MemorySystem.findSimilarOpenTasks(queryText, scope, opts)` — semantic kNN over open tasks via `IMemoryStore.semanticSearchEntities`.
- `src/memory/metadataDiff.ts` — pure `diffEntityMetadata` helper for change detection.
- 3 new lifecycle predicates: `prepares_for`, `delegated_to`, `cancelled_due_to` (taking `STANDARD_PREDICATES` from 51 → 54).
- New tests + relaxed assertion in `PredicateRegistry.test.ts`.

All 87 new/affected unit tests pass. `tsc --noEmit -p tsconfig.json` is clean.

The intent is to support the v25 task/event reconciliation pipeline. Review surfaces a few issues — no memory leaks, no security bypasses, but several correctness/contract gaps worth fixing before commit.

## Findings

### Bugs (correctness)

**B1. `findSimilarOpenTasks` does not clamp `topK` / validate `minScore`** — `src/memory/MemorySystem.ts:1660-1690`
- CLAUDE.md states the project convention: "All caller-supplied limits are clamped (maxDepth≤5, topK≤100, limit≤200, etc.)". Here `topK = opts?.topK ?? 10` is taken verbatim, then forwarded as `topK * 3` to the store. A bad `topK` (e.g. `100000`) causes a 300k-row Atlas Vector Search request.
- `minScore` is unbounded; `NaN`/negatives slip through.

**B2. `findSimilarOpenTasks` over-fetch is a no-op** — `src/memory/MemorySystem.ts:1684`
- `Math.max(topK * 3, topK)` is always `topK * 3`. The intent was almost certainly a floor (e.g. `Math.max(topK * 3, 30)`) so that small `topK` values still over-fetch enough to survive the post-state-filter. As written, `topK=1` over-fetches only 3.

**B3. `resolveRelatedItems` doc/impl mismatch on `limit`** — `src/memory/MemorySystem.ts:1581-1583` vs `1610-1631`
- Docstring: "Per-call cap on returned items (tasks + events combined). Default 50, hard ceiling 200."
- Reality: caps `tasks` at `limit` AND `events` at `limit` independently, so the result can hold up to `2 * limit` items. Either tighten the cap or correct the docstring.

**B4. `resolveRelatedItems` early-exit biases attribution to the first input entity** — `src/memory/MemorySystem.ts:1611`
- Outer loop breaks once both buckets are full. Hits from later `entityIds` never appear, even though dedupe is by item id, not by `matchedEntityId`. For a relevance-set seeded by N entities the first seed monopolises attribution. Acceptable for the v25 reconciler, but should be called out in the docstring (or change to round-robin if fairness matters).

### Doc drift (workflow rule: "after every noticeable change update docs")

**D1. Predicate count is now 54, not 51, in three docs:**
- `docs/MEMORY_API.md:1101` — `// 51-predicate starter set`
- `docs/MEMORY_API.md:1128` — "fresh registry with 51 predicates across 9 categories"
- `docs/MEMORY_PREDICATES.md:55, 111` — both say "51 predicates"
- `src/memory/types.ts:882` — comment on `MemorySystemConfig.predicates` says "51-predicate starter set"

**D2. CHANGELOG.md not yet updated** for the new public surface (`resolveRelatedItems`, `findSimilarOpenTasks`, `metadataMerge` options, `diffEntityMetadata`, three new predicates).

### Test issues (minor)

**T1. Dead config key in test** — `tests/unit/memory/MemorySystem.relatedItems.test.ts:181`
- Passes `enableSemanticResolution: true` at the top level of `MemorySystemConfig`. The actual location is nested: `entityResolution: { enableSemanticResolution: true }`. The current line is silently ignored at runtime (only escapes type-check because `tsconfig.test.json` is misconfigured — its `rootDir` is still pointed at `src/` from the extended config, and the resulting cascade of TS6059 errors masks the excess-property check). The `findSimilarOpenTasks` tests pass because the function doesn't gate on this flag — it calls `store.semanticSearchEntities` directly. Remove the line or move it under `entityResolution`.

### Code-quality (non-blocking)

**Q1. Duplicated `deepEqual`** — `src/memory/MemorySystem.ts:2688-2710` and `src/memory/metadataDiff.ts:54-76` are identical. The version in `metadataDiff.ts` is already a self-contained module — export it (e.g. as `metadataDeepEqual`) and reuse from `MemorySystem.ts`.

### Memory & disposal

No leaks. `resolveRelatedItems` uses local `Map`s bounded by `limit`. No new timers, listeners, or caches. New code respects `assertNotDestroyed`.

### Security & access control

No bypasses. Highlights of what is correctly handled:

- `applyMetadataMerge` is a pure function; the call site at `MemorySystem.ts:409-415` triggers `assertCanAccess(best, scope, 'write', 'entity')` whenever metadata changes (`dirty = merged.dirty || mergedWithMetadata.changed`) — so a user with read-only access cannot push metadata via `metadataMerge: 'overwrite'`.
- `findSimilarOpenTasks` and `resolveRelatedItems` propagate `scope` to every store call (`semanticSearchEntities`, `listEntities`, `findFacts`, `getEntity`).
- `metadataDiff.ts` is a pure helper with no IO and no scope handling — appropriate.
- `metadataMergeKeys` whitelist means a calendar-style sync caller cannot accidentally leak unrelated extracted fields into the entity record (and tests cover this case at `MemorySystem.upsertEntity.metadata.test.ts:97`).

## Fix plan

Files to modify:

1. `src/memory/MemorySystem.ts`
   - **B1**: clamp `topK` to `[1, 100]` and `minScore` to `[0, 1]` (NaN → 0). Mirror the clamping pattern already in `resolveRelatedItems` (`Math.min(Math.max(opts?.limit ?? 50, 1), 200)`).
   - **B2**: change the over-fetch to a real floor — e.g. `const overFetch = Math.max(topK * 3, 30)`. Pick `30` (or a named constant) so `topK=1` still pulls 30 candidates pre-state-filter.
   - **B3**: fix the `resolveRelatedItems` docstring to read "per-bucket cap (tasks and events each capped at `limit`)". The implementation matches the v25 reconciler's expectations; only the doc is wrong.
   - **B4**: extend the docstring to call out the early-exit ordering bias ("when `limit` is reached, later `entityIds` do not contribute attribution"). No code change unless the v25 reconciler depends on round-robin fairness — out of scope here.
   - **Q1**: export `metadataDeepEqual` from `src/memory/metadataDiff.ts` (rename the local) and import it in `MemorySystem.ts`; delete the local `deepEqual`. Keep `embeddingsEqual` separate (it's number-array-only and uses a different shape).

2. `tests/unit/memory/MemorySystem.relatedItems.test.ts:181`
   - **T1**: remove the dead `enableSemanticResolution: true` (or move under `entityResolution`).

3. Docs (workflow rule):
   - **D1**: bump `51` → `54` in `docs/MEMORY_API.md:1101, 1128`, `docs/MEMORY_PREDICATES.md:55, 111`, and the comment in `src/memory/types.ts:882`.
   - **D2**: add a CHANGELOG.md entry for `resolveRelatedItems`, `findSimilarOpenTasks`, `metadataMerge`/`metadataMergeKeys`, `diffEntityMetadata`, and the three new predicates.

4. **B1 follow-up** — add one small test to `MemorySystem.relatedItems.test.ts` covering `findSimilarOpenTasks({ topK: 100000 })` returning at most 100 items, mirroring the existing "honors topK" case. Confirms the new clamp.

## Verification

- `npm run typecheck` (clean today; must remain clean).
- `npm run test:unit -- tests/unit/memory/` — runs the existing 728 memory tests + new `relatedItems`, `upsertEntity.metadata`, `metadataDiff`, `standard.lifecycle` suites. Should remain green; the new clamp test adds 1 case.
- Spot-check by hand: `MemorySystem.findSimilarOpenTasks('x', scope, { topK: -5 })` and `{ topK: 100000 }` should both behave (return ≤ 100, no underlying store request larger than ~300).

## Out of scope (deliberately not fixed)

- Round-robin fairness across `entityIds` in `resolveRelatedItems` — the current first-wins behaviour is what the v25 reconciler is built around per the docstring. Documenting it is enough.
- Routing semantic-search failures through `this.onError` instead of `console.warn` — `console.warn(...)` is not silent (logs error message + function context), and the doc explicitly tells callers to treat results as opportunistic. Promotion to `onError` could come later if v25 wants to alert on chronic semantic failure.
