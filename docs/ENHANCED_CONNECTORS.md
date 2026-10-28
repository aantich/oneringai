# Enhanced connector contracts

Branch availability: `ConnectorTools.enhanced` is opt-in. Existing `for`, factory
callbacks, names, schemas and raw legacy results keep their behavior. No profile,
plugin, tool catalog, prompt content or retry policy is enabled globally.

```typescript
const selected = ConnectorTools.enhanced('microsoft-main', {
  profile: 'execution-v1',
  registry: authorizedRegistry,
  accountId: 'work',
  actAs: authorizedUser,
  timeoutMs: 15_000,
  onAttempt: attempt => hostMetrics.record(attempt),
});
if (!selected.length) throw new Error('No selected tools');
const agent = Agent.create({
  connector: 'llm-main', model,
  identities: [{ connector: 'microsoft-main', accountId: 'work',
    toolFilter: selected.map(tool => tool.definition.function.name) }],
  context: { model, features: { toolCatalog: false } },
  permissions: hostPermissions,
});
agent.tools.registerConnectorTools('microsoft-main', selected, { accountId: 'work' });
```

Import APIs/types from `@everworker/oneringai`. The factory returns tools; registration
and the Agent's host authorization remain explicit. Use actual returned names in the
identity filter, not an empty filter (which is not deny-all). Source-tagged registration
preserves connector/account metadata. Keep one enhanced profile per connector/account.
Configure normal host permissions: these tools preserve the owning factories' approval
requirements. The example above does not grant approval or replace host authorization.

C4's supported adoption path is static registration with catalog loading disabled.
C5 separately supplies the required manager-local catalog/profile integration and
page contracts. A selected array alone does not replace cached legacy catalog aliases.
Do not claim profile-wide protection while exposing separately authorized legacy or
generic tools that can perform equivalent requests.

## Fixed execution-v1 inventory

Names use the normal sanitized connector/account prefix followed by the operation
and `_exec`. Account is omitted when unbound. Construction validates provider-safe
names of at most 64 characters and collisions; choose short named connector/account
aliases when adopting this optional surface. Current bundled inventory is **40
specialized operations**: 28 read and 12 write. A configured baseURL also supplies
one `api_exec` per family, conservatively unknown, for **44 tools** across four
configured connectors. Custom service/overridden factories and unknown profile IDs
fail before I/O instead of silently falling back to legacy contracts.

| Owning family | Operations | Effect |
| --- | --- | --- |
| Microsoft, Google API (each) | `create_draft_email`, `send_email`, `create_meeting`, `edit_meeting` | write |
| Microsoft, Google API (each) | `get_meeting_transcript`, `list_meetings`, `get_meeting`, `find_meeting_slots`, `read_file`, `list_files`, `search_files` | read |
| Slack | `set_channel_topic`, `post_message`, `add_reaction` | write |
| Slack | `list_channels`, `get_channel_info`, `get_messages`, `get_thread`, `search_messages`, `get_mentions`, `get_users` | read |
| GitHub | `create_pr` | write |
| GitHub | `search_files`, `search_code`, `read_file`, `list_branches`, `get_pr`, `pr_files`, `pr_comments` | read |
| Each configured family | `api` | unknown |

Google uses serviceType `google-api`; Microsoft uses `microsoft`. Existing `actAs`
participation boundaries remain: it locks URL-scoped operations where the owning
factory supports it, not tenant-wide Drive/search/freeBusy visibility. Use delegated
credentials and a trusted scoped registry for the corresponding authorization.
The Connector remains the sole credential source, and current registry/account
access is checked for each invocation. Replacing the named connector with another
service fails before dispatch; reconstruct the selected profile deliberately.
The connector is captured at ToolManager admission, before asynchronous approval or
pipeline hooks; registry replacement applies to subsequent admissions. Explicitly
disposing that captured connector still revokes its transport. Enhanced bulk
registration preflights connector/account metadata and sanitized-name collisions
atomically. A conflicting account/source cannot silently overwrite selected tools.

The selected generic API retains arbitrary-method semantics and unknown effect,
but restricts its credential destination to the configured HTTP(S) origin and rejects
a model-supplied Host header or URL userinfo. Specialized factories still use their
known provider endpoints. Legacy generic tools retain their prior contracts.
Selected generic requests follow at most 20 same-origin redirects. Each hop is
checked before credentials/body are sent and observed as a separate transport
request. POST-to-GET redirects discard body headers; 307/308 preserve the method
and body. Cross-origin redirects fail without contacting the destination. That
failure does not prove the initial request had no external effect.
This origin rule does not restrict every possible operation at an authorized API;
host permissions and provider scopes still determine what the caller may do.

The profile's inventory and input contracts are versioned. Existing-schema `_exec`
operations retain the owning input schemas. A changed collection/input contract
uses a separate selected profile and distinct `_page`/`_strict` names. New profile
IDs are runtime-validated strings, not a required migration or closed enum.

## Outcomes, deadlines and attempts

Owning factories explicitly report their operational failure returns through C1.
An HTTP/API error or known local validation failure becomes a failed semantic outcome
while its raw result remains available. Arbitrary application payloads are never
classified by a ToolManager-wide `success: false` heuristic. Legacy factory results
retain their old semantics unless the enhanced profile is selected.

Microsoft reply-draft/create-and-send flows retain an optional `acceptedResources`
array on new profile results, including later failure. An entry has
`{ kind: 'reply_draft', id, state: 'accepted' }`; it records an observed earlier
component acceptance, not final message delivery or business completion. A missing
usable ID stops the selected follow-up write. Old tools do not gain this field.
No generic intermediate HTTP-body journal or new backend is introduced.

`timeoutMs` is a host-owned whole invocation deadline, defaulting to the configured
connector timeout or 30 seconds. Zero disables this added deadline; existing manager
hard limits/caller signals still apply. Values are integers through 2,147,483,647 ms.
A shorter per-call tool deadline wins. Context signal flows through token waits,
backoff, each request and body consumption; a shared underlying auth wait is not
cancelled for other callers. CPU work/provider code that ignores cancellation can
still settle late. Cancellation/timeouts do not establish whether a write happened.
Raw late outcomes/evidence retain the existing ToolManager lifecycle contract.
`executeWithOutcome` can throw an error carrying `.outcome` for cancellation/timeouts;
do not assume every outcome is returned as a resolved report.

The selected path reuses Connector.fetch's operation timeout/safe retry policy:
GET/HEAD/OPTIONS reads may retry according to connector configuration. Read-only POST
search methods remain conservatively unretried by this initial safe policy. Writes
and arbitrary generic calls do not retry, including generic GETs with unknown effect.
A multi-request write checks cancellation before each next request and never repeats
an earlier accepted step to recover an observation.

`onAttempt` receives credential-free `EnhancedConnectorAttempt` metadata: connector,
toolName, optional actual accountId, per-tool invocationId, logical requestId, physical
attempt number, method, startedAt, and dispatched/received/failed state. Received
includes header HTTP status/duration, not a claim that the body finished. Count
**dispatched** events for physical attempt totals; invocation/request IDs distinguish
multi-request operations from retry attempts. These IDs are separate from ModelTask
model invocation IDs. No URL, headers, body or credentials are included. Synchronous
and asynchronous observer failures are isolated and never justify a request retry.
These events cover Connector.fetch transport attempts after authentication; internal
OAuth credential-refresh transport has its existing separate lifecycle. Transport
counts and external API fees do not become LLM token/cost usage. Automatic HTTP
retry boundaries do not grant permission for a model/workflow to submit another
mutation; use host verification and the selected managed-loop policy for that boundary.

## Large source and evidence

Read tools provide deterministic source views through the existing evidence plugin.
The enabled plugin acknowledges the complete allowed/redacted raw tool result before
using a projection. Views omit known body strings while preserving IDs, statuses,
counts, continuation/completeness fields and other metadata. They never slice an
array prefix into an apparently complete result. If the view does not fit the existing
summary allowance, evidence reports projection failure and retains raw data.
Generic unknown result shapes are not given an automatic summarizer.

Raw application returns and execution events remain raw; inspect `outcome.evidence`
separately from operation status. Recover exact data through existing bounded evidence
reads/full host reads. Storage/projection failure cannot justify repeating a write.
Existing evidence scope, redaction, serialization/storage limits and durability
contracts remain authoritative. Enabling a profile does not enable evidence.

The raw source here is the owning tool's allowed result, not an unbounded copy of
all provider data/intermediate HTTP bodies. Existing read-file offset/limit and
truncated indicators remain, including GitHub line-number formatting. C4 does not
change legacy collection totals/caps or prove that remote collections are exhausted;
C5 adds explicit logical-page contracts. Mutable external data still requires host
checks for consistency and completion.

Saved context does not serialize profile closures, host registry, approval callbacks,
transport observers or continuation authority. Reconstruct selected tools and host
configuration before loading/using the session. Remote protocol v2 retains its old result/error
contract; negotiated remote outcome/evidence parity is C7, not a C4 guarantee.
Existing sessions/configurations
continue to load without selecting a profile. Borrowed/shared manager ownership
stays unchanged; no second pipeline is created.

## Examples and AMOS

After building, `npm run example:enhanced-connectors` runs offline with a local HTTP
server and temporary FileEvidenceStorage. A safe read retries once; its complete
allowed source remains recoverable after rollover. A synthetic mutation occurs once
and responds HTTP 503; the framework reports failure and does not replay it. The
example makes zero LLM calls, grants approval only to this synthetic service, closes
the server/Agent/connectors and removes temporary evidence.

AMOS uses its existing truthful outcome/evidence presentation; an adapter test
executes a real selected owning factory through it. No second C4 command/policy
system or default app configuration change is needed. C5 handles catalog adoption.
The opt-in live gate `RUN_ENHANCED_CONNECTORS_LIVE=1` exercises managed run/stream
with actual OpenAI, Anthropic and Google models against local synthetic HTTP only.
It never writes to an external Microsoft/Google/Slack/GitHub service. Branch
availability is distinct from package release or ICOS dependency adoption.
