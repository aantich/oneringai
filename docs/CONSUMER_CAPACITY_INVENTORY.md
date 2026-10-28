# Consumer capacity inventory

C5 audit, 2026-10-23. Bounds serve different owners: provider input constraints,
one request/page hints, prompt views, protocol/parser admission, source storage,
execution work and intentionally transient coordination. Increasing all of them
would not establish source completeness. The table records current behavior and
retrieval/overflow contracts, rather than treating a bounded view as a total.

| Boundary / owner | Current allowance / configuration | Overflow and exact-source behavior | C5 disposition |
| --- | --- | --- | --- |
| Legacy collection tools / owning connector factories | Method-specific limit/maxResults and Slack helper ten-page stop | Old result/count/hasMore contracts stay frozen; some positions were discarded | New collections-v1 replaces 17 affected reads with whole logical pages and explicit positions/coverage |
| New provider page hints / host plus provider | pageSize defaults 100; meetings 25; Slack search 20; schema maxima 100/200/1000 by family | Provider can under/over-return; return every allowed fetched row; no local prefix cutoff | Stable 14-page/over-return fixture verifies exact IDs; provider ceilings remain explicit coverage boundaries |
| Continuation parser / collections-v1 | Fixed 65,536 ASCII wire bytes; authenticated AES-GCM | Invalid/mismatched/expired-manager input fails before transport; oversized observed position retains complete observedPage and unknown position | No item tail store, larger arbitrary total or cursor backend |
| Slack topic / provider | 250 Unicode code points in new strict schema | New strict path sends exact input or fails pre-I/O; old paths keep prefix normalization | Emoji/combining-mark boundary regressions; provider remains final validator |
| GitHub indexed/tree search / provider and old client | Provider code-search ceiling; tree truncation; old non-default code scan had a 50-file prefix | New indexed code pages reject unsupported ref; explicit-ref tree returns all matching fetched rows and incomplete coverage when provider truncates | No silent client scan prefix or new crawler; no claim beyond provider coverage |
| GitHub read_file / host range | Default 2000 lines, explicit offset/limit, totalLines/truncated | Caller can request subsequent line ranges; line-number formatting retained; no per-line prefix cap | Recoverable range, unchanged; acknowledged source means that allowed range |
| Microsoft/Google file readers / parser admission | Configurable default/per-extension file-size ceilings; owning defaults documented in factories | Oversized input fails explicitly before parse; parser supports attachments/content forms; no success claim from a hidden prefix | Keep admission protection; no reproduced selected successful-source loss requiring redesign |
| Evidence serialization/storage / evidence backend | Bundled default record 4 MiB, scope 64 MiB /1000 records; maxRecordBytes/maxTotalBytes/maxRecords; middleware maxSerializationBytes | Capacity fails; unacknowledged raw results remain protected; acknowledged records use scoped IDs/integrity | Keep quotas; custom backend final quota still applies; no read/action replay for storage repair |
| Evidence read/concurrency / backend | Default 8192 chars/chunk, 8 reads, 32 pending writes; configurable | nextOffset retrieves full record; busy is explicit; host readRecord returns full acknowledged JSON | Example reads bounded concurrency; no source slicing |
| Evidence prompt projection / middleware | Threshold 8192 bytes; maxSummaryChars 2000; maxProjectionChars 4096; configurable | Source acknowledged first; projection failure retains raw; selected projection preserves all row IDs/metadata or fails | No apparent complete array prefix; body removal is a recoverable view |
| Verified routine observations / C3 host | Default 1 MiB JSON view, configurable 8 KiB–64 MiB; active operations 32, configurable 1–1000 | Full retained sources/readSource plus explicit host archival acknowledgement; view is not a heap bound | Source index recovers omitted headers; preserve close/late-work protections |
| Routine model-facing reference packet / C3 | 32 references plus omitted count; inspection 24 headers plus complete source index | Explicit omissions; host exact-source access survives waiting/close until safely retired | Keep bounded model view; no workflow journal |
| Managed completion packet / loop policy | 32,768 output chars with outputTruncated; latest 100 observation headers with observationsTruncated; JSON packet 1 MiB | Host checker sees truncation; actual response/tool source/evidence remain distinct; distinct tracking stops at1000 rather than silently continuing | Keep callback/view protection; do not use a truncated packet as proof of unseen content |
| Managed recovery/preset work / host | Existing maxIterations; research preset12/other presets8; maxRecoveryAttempts2, explicit override | Explicit stop/recovery diagnostics; tool/model work share their separately selected budgets | Work allowance, not result completeness; no arbitrary larger data cutoff |
| Protected task state / host | maxEntries100, maxPromptTokens8000, maxSnapshotBytes256 KiB; configurable | Atomic admission fails; explicit confirm/prune/correction APIs; host archives proof before pruning | Preserve authority and revision protections; never replay an action to fit state |
| Shared workspace / transient board owner | maxEntries50, maxTotalTokens8000, maxLogEntries100; configurable; prompt recent-log view10 | Board evicts archived/old entries and retains bounded recent log; onEntriesChanged lets host observe changes; external references/archive are host-owned | Intentional coordination board, not a durable evidence/action ledger; unchanged scope |
| Portable v2 parser / protocol owner | Package10 MB, args/result1 MB, 512 tools,128 plugins,10k messages/content items; fixed versioned admission | Explicit compatibility/serialization errors; bounded error messages are diagnostics, not source storage | Keep literal v2 DTO/allowlists; C7 defines a separate negotiated source/outcome path |

Source owners: [page contracts](../src/tools/connector/pages/contract.ts),
[cursor codec](../src/core/connector-execution/cursors.ts),
[connector readers](../src/tools/connector/enhancedProfiles.ts),
[evidence backend](../src/infrastructure/storage/EvidenceStorage.ts),
[evidence middleware](../src/core/evidence/ToolEvidenceMiddleware.ts),
[routine facade](../src/core/routines/createRoutineRunner.ts),
[loop controller](../src/core/agent-loop/LoopController.ts),
[task state](../src/core/context-nextgen/plugins/TaskStatePluginNextGen.ts),
[workspace](../src/core/context-nextgen/plugins/SharedWorkspacePluginNextGen.ts),
[presets](../src/core/presets.ts), [portable parser](../src/portable/AgentPackage.ts).

The audit does not authorize changes to unrelated legacy contracts, storage
retention, database selection, durable workflows or distributed exactly-once
execution. Source durability is the acknowledged backend's actual support, not
an implication of a prompt view, count, successful HTTP response or cursor.
