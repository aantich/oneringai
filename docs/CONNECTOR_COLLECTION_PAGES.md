# Whole connector collection pages

Branch API, explicitly opt-in; no verified package release. Import
`ConnectorTools`, `ConnectorPage<T>` and `PagePosition` from `@everworker/oneringai`.
Execution-v1 remains the fixed C4 static profile. Select **collections-v1** for
page contracts, strict topic input and the manager-local catalog adapter.

```typescript
const selected = ConnectorTools.enhanced('drive-work', {
  profile: 'collections-v1', accountId: 'work', registry: authorizedRegistry,
});
if (!selected.length) throw new Error('Empty selected profile');
const agent = Agent.create({
  connector: 'llm-main', model,
  identities: [{ connector: 'drive-work', accountId: 'work',
    toolFilter: selected.map(tool => tool.definition.function.name) }],
  context: { model, features: { toolCatalog: true } },
  permissions: hostPermissions,
});
agent.tools.registerConnectorTools('drive-work', selected, { accountId: 'work' });
```

Use short names (64 provider characters maximum), actual selected names and existing
source/account registration. Choose one profile per connector/account/manager; a
conflicting selection fails atomically. Filter the returned array first when the
host admits only a subset. Identity filters govern discovery/generation and do not
replace host authorization of manually registered tools. A raw array does not adopt
the catalog contract: use `registerConnectorTools`. This registration replaces only
that selected identity's source-tagged legacy aliases, including disabled aliases.
Other accounts/managers, global factory caches and unselected catalogs remain intact.
New collections-v1 connector/account aliases cannot contain `:` because the existing
catalog category format uses that separator; ambiguous source identities fail
preflight rather than being remapped. Legacy/execution-v1 naming remains unchanged.
Unattributed separately authorized tools/generic APIs are outside that guarantee.

Configure host selection before the first run or loading a saved catalog/session.
Host configuration is not inferred from model arguments or restored from untrusted
messages. Reapply it when constructing a new Agent. Saved categories/conversation
do not store profile authority or cursor keys. Execution-v1 retains its earlier
static recipe with catalog disabled; upgrading to collections is deliberate.

## Inventory and inputs

The profile retains 44 potential tools across the four configured families, with
17 `_page` variants, one Slack `_strict` and 26 `_exec` variants. A connector without
baseURL omits its generic API. Unsupported/custom factories/profiles still fail
construction; the private manifest is not another public registration system.

| Family | Page operations | Provider collection |
| --- | --- | --- |
| Microsoft | `list_files`, `list_meetings`, `search_files` | drive children/search; calendarView; site drive search or tenant Search |
| Google API | `list_files`, `search_files`, `list_meetings` | Drive files; Calendar events |
| Slack | `list_channels`, `get_messages`, `get_thread`, `get_users`, `search_messages`, `get_mentions` | conversations; thread parent/replies; users; one search page |
| GitHub | `search_files`, `search_code`, `list_branches`, `pr_files`, `pr_comments` | explicit-ref tree; indexed code search; branches; PR files; selected discussion collection |

New page input schemas retain relevant existing filters and required fields, replace
`limit`/`maxResults` with `pageSize`, add `continuation`, and reject unknown keys.
They do not append pagination keys to old tools. Inspect the returned public tool
schemas for exact supported enums and defaults. Page-size hints default to 100,
25 for meetings and 20 for Slack search. Maximum hints are 100 for GitHub/Slack
search, 1000 for Google and 200 for the other selected operations. Providers may
return fewer or more items; no local prefix is sliced. These are request hints,
not total collection allowances or rate-limit promises.

Google Drive adds explicit `corpora`, `driveId`, `supportsAllDrives` and
`includeItemsFromAllDrives`; supported `orderBy` values are in its schema. Query
quotes are escaped without deleting user text. File-type filters reject unsafe
syntax; supported MIME/extension mapping retains the owning helper. Microsoft
site-scoped search rejects unsupported `fileTypes`, before transport, instead of
silently dropping rows with a client filter. Tenant-global Microsoft search does
not invent a per-user URL/actAs lock. Connector credentials determine that scope.

GitHub tree search requires explicit `ref` to fetch one tree without a hidden branch
lookup/crawl. It returns every matching allowed row and reports `truncated` as
incomplete coverage. Indexed code search rejects `ref`; it does not silently scan
an arbitrary prefix of branch files. `pr_comments_page` chooses `commentType`:
`issue` (default), `review_comment`, or `review`. Traverse all three independently
if the task needs all discussion and review records. Branch/deactivated-user
filters select allowed rows on the fetched page; continuation still follows the
whole provider page. Thread items include the parent when returned by Slack;
`returnedCount` does not pretend to count only replies.

Slack `set_channel_topic_strict` accepts at most 250 Unicode code points (JSON
Schema string length), sends exact text unchanged, and rejects overflow before
transport. Combining marks count individually; provider validation still applies.
Legacy/execution-v1 topic prefix normalization remains unchanged.

## Page position and coverage

```typescript
interface ConnectorPage<T> {
  items: T[];                 // full allowed provider rows, including metadata
  returnedCount: number;      // exactly items.length, not a collection total
  reportedTotal?: number;     // only a valid total actually supplied by provider
  searchCoverage: 'complete' | 'incomplete' | 'unknown';
  position:
    | { state: 'more'; continuation: string; positionId: string }
    | { state: 'end' }
    | { state: 'unknown'; reason: string };
}
```

One call makes one logical page request, with the [C4 deadline/outcome/attempt
contract](ENHANCED_CONNECTORS.md). Safe GET reads can retry through Connector.fetch;
Microsoft POST search remains conservatively unretried. Mention search also checks
the authenticated Slack user through the existing auth helper; that authentication
request is counted separately from its one search page. Continuation rejects an
identity drift before reading a different user's next search page. Strict writes
never gain automatic retries.

Full, partial or empty arrays alone never prove more/end. Graph uses its complete
opaque nextLink and reapplies required headers. Slack uses cursor/paging metadata;
GitHub uses Link relations. Missing/unusable/contradictory continuation metadata is
unknown and a failed semantic observation, with the complete observed page retained.
An oversized provider position likewise returns all items plus `observedPage`,
without an invented continuation. Inspect the raw result even when status is failed.
Do not repeat an external write to repair source bookkeeping.

End means provider pagination ended; it does not prove an exhaustive corpus or
business completion. Drive incomplete-search history persists across later pages,
including an empty/final page. Missing coverage remains unknown. GitHub code-search
ceilings/truncation and PR-file provider limits do not become complete coverage.
Slack search remains unknown corpus coverage because provider filters/grouping can
omit matches. Provider indexing, visibility and mutable-collection snapshot/delta
guarantees remain external constraints. Narrow queries deliberately when needed.

## Opaque continuations and source recovery

Tokens are authenticated encrypted envelopes, at most 64 KiB, bound to the current
manager, connector instance/base origin, account, host principal/roles/session/
identities, operation, normalized query/order/page size and prior coverage. A token
does not grant authorization: current connector scope/permissions are checked at
admission. Provider URLs remain constrained to the configured origin and expected
collection path. Model-selected URLs are not accepted as continuation positions.

Keep identical normalized inputs. Explicit defaults equal omitted defaults; a changed
query/order/size/host identity invalidates the token before transport. `positionId`
is a stable opaque HMAC for loop detection, independent of randomized encryption and
coverage changes. Detect repeated IDs and stop explicitly. Do not use the envelope
string itself for loop detection or present the fingerprint as an authorization key.

The manager companion retains its codec through catalog unload/reload, compaction,
context rollover and temporary composition scopes. Direct `.execute` calls have a
separate tool-set lifetime. A new manager/process, explicit manager clear, or lost
tool-set codec invalidates old tokens before transport. Saving/loading conversation
does not make cursors durable; no tail store, cursor database, hidden TTL or model
call per page is introduced. Provider token expiry can still cause a real request
failure. The host decides whether and how to restart a read traversal.

Evidence remains separately opt-in. Its middleware acknowledges the complete allowed
raw result before projection; no projection slices row prefixes. Oversized/failed
projections retain raw source, and storage failures retain the existing protected
observation lifecycle. Read acknowledged records with bounded evidence tools or full
host storage reads. Redaction, serialization quotas and actual backend durability
remain the [evidence contract](DURABLE_EVIDENCE.md). No implicit source backend is
enabled by selecting a profile.

Run `npm run example:connector-pages` after building. The offline example uses a
local HTTP server and temporary FileEvidenceStorage, verifies 49 stable IDs across
14 pages (over-return, intermediate empty, final partial), tests catalog/rollover
and fresh-manager loss, and cleans up. It makes zero model calls/external writes.
AMOS renders returned count, provider total only when supplied, position and search
coverage independently. See the [capacity inventory](CONSUMER_CAPACITY_INVENTORY.md)
and [delivery record](designs/CONSUMER_C5_DELIVERY.md).
