# C5 — whole collection pages and local catalog ownership

Status: complete on branch under full sequential authorization; no package release.

## Stage-entry API review

`ConnectorTools.enhanced(name, { profile: 'collections-v1', ...existingOptions })`
keeps execution-v1 frozen and reuses its deadline/outcome/attempt/account mechanics.
The new profile replaces 17 affected read operations with `_page` and Slack topic
mutation with `_strict`; the other operations remain `_exec`. Page inputs retain
relevant filters, replace total `limit`/`maxResults` with `pageSize`, and add opaque
`continuation`. New root types `ConnectorPage<T>` and `PagePosition` match the approved
proposal. Items are complete allowed provider rows, not the old mapped/prefix view.

`pr_comments_page` explicitly selects issue/review-comment/review collection (`commentType`, default
issue), because those are distinct endpoints. GitHub tree search requires an explicit
ref (one tree fetch) and reports provider truncation; code-search pages use the indexed
default-branch endpoint and reject an unsupported explicit ref rather than scanning
an arbitrary file prefix. These restrictions affect new tools only. They avoid a
second crawling runtime and a hidden promise of complete remote search.

The private manager companion is installed by existing `registerConnectorTools` for
collections-v1 tools. Execution-v1 retains C4's static adoption/coexistence behavior;
its catalog path remains unsupported. The companion retains category definitions/profile and one ephemeral
codec per manager, independent of enabled registrations. Catalog discovery/search/
load/unload overlays only that manager's selected categories, removes that identity's
legacy aliases, and preserves exact identity filters/source/account. Other managers
and unselected catalogs retain existing behavior. Temporary composition scopes
intersect visibility/dispatch, without replacing the companion or cursor key.

AES-256-GCM continuation envelopes bind connector instance/base origin, account,
trusted host principal/roles/session/identities, operation, normalized query/order,
and coverage history. Wire tokens are at most 64 KiB. Stable HMAC position IDs exclude
nonce and coverage, so repeated positions are detectable. Invalid/forged/mismatched
tokens fail before transport; a new manager/process cannot decode old tokens. No TTL,
tail store, durable cursor backend, model call per page or public registration layer.

Provider next URLs are authenticated data, still checked against configured origin
and expected collection path on every use. Graph nextLink is preserved verbatim and
required headers are reapplied. Full/empty counts never prove exhaustion. Previously
incomplete Drive coverage survives later pages. An unusable/oversized provider
position returns the whole observed page with unknown position and explicit failure;
existing evidence can acknowledge it. No source is discarded to make a view fit.

## Provider evidence

Reviewed 2026-10-23: Graph's [opaque nextLink](https://learn.microsoft.com/graph/best-practices-concept)
and [subsequent request headers](https://learn.microsoft.com/en-us/graph/sdks/paging);
[Drive v3 page token/coverage](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list);
[Slack reply cursors](https://docs.slack.dev/reference/methods/conversations.replies/),
[search paging and its provider boundary](https://docs.slack.dev/reference/methods/search.messages/),
and [topic validation](https://docs.slack.dev/reference/methods/conversations.setTopic/);
[GitHub Link pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
and [PR-file provider ceiling](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files).
Provider exhaustion is separate from corpus coverage, indexing, snapshot consistency
and provider search ceilings. A missing guarantee stays unknown.

Acceptance requires exact stable fixture IDs beyond ten pages, over-return, empty/
partial/final pages, malformed/missing/repeated/oversized positions, query/order/
principal/account changes, fresh-manager loss, actual Agent/catalog reload/scoping,
cancellation/retry/evidence failures, Unicode topic boundaries, a capacity inventory,
examples/AMOS and cumulative compatibility/full validation. Results follow below.

## Review and corrections

The final implementation has one small private manager companion, codec and owning
provider readers over Connector.fetch; no factory registry, tail store, cursor
backend or crawling engine. Registration preflights source/account/name conflicts
and rejects ambiguous new colon aliases. Catalog discovery, search, reload,
compaction, inspection/state and instruction token counts use the selected revision.
Fresh managers/clear do not restore old keys. Required Graph headers/opaque URLs,
complete over-returned rows and sticky Drive coverage are independently tested.

Review narrowed alias/catalog replacement to collections-v1, preserving C4's static
coexistence and sealed-manager support. It fixed initial catalog compaction,
authenticated mention-query identity drift, tenant-global Microsoft app-token
search, malformed/oversized observation retention and identity filter snapshots.
The public prototype now imports PagePosition locally so its negative control fails
for the intended missing continuation/positionId, rather than a missing type name.
Unicode validation sends accepted text exactly, with no legacy UTF-16 prefix slice.

## Validation and documentation

All **9,002 unit tests** pass: 75 additional cases (71 collection, one C4 compatibility,
three AMOS). **251 cumulative live tests /18 files across OpenAI, Anthropic and
Google** pass, including six new C5 run/stream cases; zero failed/skipped tests or
suites remain. All **1,062 public runtime assertions** (240 new across 16 mixed ESM/
CJS/duplicate combinations), **45 offline modes**, build/24 exports, types, lint,
compatibility consumer, 14 real design negative controls, example/AMOS types and
generated API pass. Package inventory and local documentation links are audited.
Exact commands/artifacts/hashes are in the [validation record](../evaluations/CONSUMER_C5_VALIDATION_2026_10_23.json).

An initial cumulative live attempt overlapped a clean build: dist disappeared while
ContextStrategies resolved the public package, so its 40 cases did not run although
211 other cases passed. That attempt is not validation. The final run starts after
build completion, keeps dist stable, and passes all 251. No provider/source failure
is waived. The offline example initially counted two catalog evidence records as
source pages; it now verifies source records by tool name and reads within backend
concurrency, without loosening the 14-page/49-ID/zero-model-call oracle.

The [offline example](../../examples/connector-collection-pages.ts) verifies the exact
49-ID hash over 14 pages, provider over-return, an empty intermediate and final
partial page, catalog reload, context rollover, reopened FileEvidenceStorage and
fresh-manager rejection, with zero LLM/external-service calls. AMOS renders returned
count, actual provider total, position and coverage separately, including failed
unknown-position observations. No default AMOS profile migration is introduced.

The [page guide](../CONNECTOR_COLLECTION_PAGES.md), [capacity inventory](../CONSUMER_CAPACITY_INVENTORY.md),
Version 2 availability/adoption/handoff, README/User Guide/generated API/examples/
AMOS/changelog/agent guide are updated. Saved DTOs, old factories/defaults/results,
execution-v1 static behavior and literal remote protocol 2 remain intact. Provider
corpus/index ceilings, token expiry, snapshot consistency and actual source backend
quotas remain explicit support boundaries. Durable cursors/workflows, database/
retention choice, consumer adoption and release remain excluded. Continue C6.
