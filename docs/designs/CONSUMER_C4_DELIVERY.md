# C4 — fixed connector execution profiles

Status: complete on branch under the existing sequential authorization; no package release.

## Stage-entry API and implementation design

`ConnectorTools.enhanced(name, { profile: 'execution-v1', registry?, accountId?,
actAs?, userId?, timeoutMs?, onAttempt? })` is additive. IDs remain runtime-validated
strings. Whole-invocation deadlines default to the connector timeout or 30 seconds;
zero disables that extra deadline, while existing manager/provider limits remain.
`onAttempt` observes bounded credential-free physical header-transport events;
count dispatch events separately from logical operations/pages/model usage.

The private fixed manifest covers the bundled Microsoft/Google/Slack/GitHub
factories plus conservative generic APIs. Enhanced names end in `_exec`; definitions,
account bindings and cached legacy tools remain isolated. Custom overrides and
unsupported profiles/services fail construction before I/O. No public factory
registry, ambient execution context or second HTTP client is introduced.

Each invocation resolves current trusted connector scope, instantiates the existing
owning factory around an invocation-bound connector proxy, forwards its exact signal,
and uses existing Connector.fetch operation deadlines/safe retries. Mutations and
arbitrary generic operations do not retry. Read POST operations remain conservatively
unretried by the existing safe policy. The owning factories explicitly report their
own failure-return branches through C1; arbitrary application payloads are not
classified by shape. Raw returns/events and all unselected legacy behavior remain.

C4 delivers static source-tagged registration with exact identity tool filters and
tool catalog disabled. C5 owns the required manager-local catalog selection gate
and separate whole-page/strict contracts. Validation, inventory/projection support,
examples, AMOS applicability and final evidence will be recorded before completion.

Stage-entry review refinement: the new `_exec` results expose optional
`acceptedResources` for the identified Microsoft reply-draft acceptance before a
later PATCH/send. That ID otherwise disappears on partial failure. This changes
only the new profile's result data; old tools remain byte-compatible. A resource
marked accepted is not a final remote completion claim. No generic HTTP-body
journal/backend or mandatory evidence plugin is added.

## Review and corrections

The fixed manifest audits all 40 specialized operations plus four configured generic
APIs. Seventy-three owning operational failure branches report explicit provenance;
legacy callers keep their raw results/classification. Shared account binding and
cross-bundle selected deadline/denial metadata use private versioned seams.

Review fixed credential destination/Host validation on the selected generic API,
partial Microsoft reply-draft IDs, connector admission capture before yielding
pipeline hooks, atomic enhanced account/source/name collision checks, and rejected
async diagnostic callbacks. Legacy sealed ToolManagers and RequestInit proxies
remain usable when private coordination cannot be installed/reflected. Regression
tests preserve old definition-only deadlines and old generic contracts. The latter
are characterized for compatibility, not recommended for broader authorization.

## Validation and support

### Subsequent holistic review corrections — 2026-10-28

The origin check now covers every selected generic redirect hop, using the existing
Connector transport with manual redirect admission. Same-origin 301/302/303/307/308
behavior is preserved, with a 20-hop bound, one observation per dispatched request
and cancellation during intermediate body cleanup. Cross-origin redirects cannot
forward custom API-key headers or a write body. A redirect failure does not prove
that the initial request had no effect. Specialized provider downloads and old
generic factories retain their existing redirect behavior.

Real two-origin HTTP regressions cover both enhanced profiles, custom API-key
headers, POST method/body behavior, loops and a paired unchanged legacy control.
The offline example illustrates same-origin success and zero requests at a rejected
foreign origin. The corrective cumulative gates are recorded in the delivery ledger;
the original slice totals below remain historical. No new public API or AMOS control
is needed. Live LLM testing remains paused.

All **8,927 unit tests** pass (42 additional cases since C3), **245 cumulative live
tests across all three providers** pass, and the final frozen C4 source passes six
additional run/stream cases. There are zero failed/skipped unit/live cases. The
822 public runtime assertions include 228 C4 assertions across 16 mixed ESM/CJS
and duplicate-copy combinations. All 44 offline modes, build/24 exports, types,
lint, compatibility consumer, 14 proposal negative controls, examples/AMOS types,
generated API, package inventory and local documentation links pass. Exact artifacts
and source hashes are in the [validation record](../evaluations/CONSUMER_C4_VALIDATION_2026_10_23.json).

The first live fixtures lacked the existing host permission grant and stopped
before HTTP; those fixtures now explicitly approve only synthetic services, while
a separate regression proves default denial remains. Two OpenAI synthetic SHA
assertions selected the evidence digest rather than the provider revision; clarified
the prompt to select `summary.metadata.sha`, retained the two-call budget and exact
oracle, and reran all six plus the cumulative matrix. No failure is waived.

The [runnable example](../../examples/enhanced-connector-execution.ts) uses a real
local HTTP server without an LLM or external write. It demonstrates safe GET retry,
one ambiguous mutation dispatch, source-tagged identity/account registration and
exact acknowledged file evidence after rollover. AMOS's existing outcome adapter
is tested against an actual enhanced factory; no new default profile/UI is needed
for C4's static path. The [recipe](../ENHANCED_CONNECTORS.md), Version 2 adoption,
README/User Guide/examples/AMOS/unreleased notes and generated API are updated.

Scope: static registration with catalog disabled; C5 supplies catalog/page contracts.
Evidence is separately opt-in, raw source is the owning tool's allowed result, and
transport observations omit credential-refresh internals. No remote final-completion,
durable cursor, C7 parity, consumer upgrade, backend, default change or release is
claimed. Proceed directly to C5 under the user's full-sequence authorization.
