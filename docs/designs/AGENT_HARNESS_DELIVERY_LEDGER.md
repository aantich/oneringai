# Agent harness expansion delivery

Current corrections: the 2026-11-01 review found four defects. Their fixes and
validation are recorded in the correction section below; earlier counts are historical.

Scope: revision 3 of [the design](AGENT_HARNESS_EXPANSION.md), explicitly authorized
on 2026-10-28 by “implement everything end to end, verifying and fixing after each
logical stage”. H0–H6 are sequentially authorized. No release, consumer upgrade,
breaking change, or live LLM testing is authorized. The existing live-testing pause
remains in force.

Baseline: `53e85de71a4949dc5ce85d3b09d011995782468c` on `version2`.

| Stage | Status | Evidence |
| --- | --- | --- |
| H0 contracts and baseline | Complete | Existing 55 runtime tests pass; installed SDK configuration fixture and design contracts were checked in the preceding review. Legacy status/event unions remain unchanged. |
| H1 definitions and host tools | Offline validated | 62 runtime tests, including native materialization and authenticated MCP; typecheck/build/export checks and built/extracted-package swappable example pass. Live SDK/MCP remains pending. |
| H2 local Claude | Offline validated | 68 runtime tests pass; source/example type checks, lint, build/ESM+CJS identity checks, generated API and extracted-package Claude example pass. Official SDK 0.3.312 interface verified; live pending. |
| H3 durable sessions | Offline validated | 76 runtime tests, source/public-example types, build/export checks, generated API, and source/extracted-package two-process recovery pass. No workflow authority restoration or live-provider claim. |
| H4 OpenAI managed | Offline validated | Seven native-SDK wire cases; 83 runtime tests, source/example types, build/export/docs and extracted-package example pass. Live pending. |
| H5 Claude managed | Offline validated | Nine actual-SDK wire cases, credential rotation/ambient-header isolation, owned/borrowed cleanup and source/extracted-package gate in H6. Live pending. |
| H6 files, AMOS, package conformance | Offline validated | 9,294 units / 133 runtime+AMOS cases after the November review corrections; all eight source and extracted-package examples, two managed process-crash recoveries, built AMOS CLI, ESM/CJS entries and public contract checks pass. Live pending. |

Availability here means source on this branch, not a package release. Mock transport
coverage is not live vendor verification. Native routine/ModelTask authority is
never restored from a runtime session reference.


H1 review fixed conflicting definition fields, duplicate/async tool admission,
undeclared native additions, request-ID conflicts, scoped reference access, lifecycle
hook completion and a pre-existing public-package identity issue. Shared build chunks
now preserve root/runtime Connector/Agent identity for ESM and CJS. The packaged example
was extracted into `/private/tmp/oneringai-h1-package` and exercised with the checkout's
dependency installation. No optional native CLI or API was launched. `npm pack` used
`--ignore-scripts` and a temporary cache; no publication/version command was run.

Commands: `npx vitest run tests/unit/agent-runtime --reporter=dot` (62 pass, local-only
listener required sandbox escalation); `npx tsc --noEmit`; `npm run build`;
`node --import tsx scripts/generate-api-docs.ts --mode public`;
`npx tsc --noEmit -p examples/tsconfig.json`; `node --import tsx examples/agent-runtime-swappable.ts`;
`npm pack --ignore-scripts --cache /private/tmp/oneringai-pack-cache --pack-destination /private/tmp`;
extracted-package example using the tsx loader. These are offline checks.


H2 review covered the SDK's actual API-key configuration, raw MCP JSON schemas,
continuation IDs, empty native tool/config/plugin/delegation sets, permission denial,
terminal error subtype handling independent of is_error, local structured validation,
redaction, lifecycle cleanup and partial usage coverage. The packaged Claude example
ran twice through real in-process MCP with a scripted query and no CLI launch.
Source and examples typecheck, runtime lint, 68 tests, build and API generation passed.
The optional SDK is a dev dependency and optional peer, external to base imports.


H3 review fixed exclusive-writer/revision handling, concurrent outbox admission,
failed-acknowledgement result retention, changed-scope/workspace/native-configuration
checks, borrowed manager identity, credential-free native state markers, protected
evidence projections, observer detach versus cancellation, suppressed false terminal
states and cleanup-error masking. Legacy regression: post-open invalid-capability
cleanup must preserve the original error even if native cleanup also fails.

Validation: 76 runtime tests pass. Additional lifecycle/native definition subset:
21 pass. `npx tsc --noEmit`, example public-package typecheck, runtime lint,
`npm run build` including ESM/CJS identity checks, `docs:public` equivalent generation,
and source/extracted-package recovery examples passed. The recovery example ran two
actual processes for each case, including an intentional child crash after the mock
service acknowledged its write. Both recovered with exactly one input and one write.
The artifact was packed with scripts disabled and temporary cache, not published.
Native active SDK input, missing transcript files and opaque native continuation
sources remain explicit unsupported/unknown recovery paths. No live LLM tests ran.


H4 uses the installed OpenAI SDK (7.30.x contract), with current official quickstart,
session-event and turn/item references checked. Review corrected the exact artifact
list API (client-side turn filtering after pagination), deferred no-environment native
creation until first input, verified owned metadata/configuration, prevented old-turn
matching after ambiguous continuation, and made live buffering start before saved-state
retrieval. Mock HTTP runs through the actual SDK. Lost tool-result responses before and
after acceptance both preserve one execution; idle/closed streams stay nonterminal;
active detach/recovery preserves one native input and does not cancel it.

Validation: seven wire tests, full runtime suite (83 pass), source/example typechecks,
runtime lint, build plus ESM/CJS export identity, regenerated API docs and source/extracted
package managed example. No API credentials/native account were used. A full-suite
fixture failure exposed missing named-connector registration in synthetic drivers;
fixtures now register explicit no-auth offline connectors, preserving connector-first
semantics. Native artifact inventory is bounded and separate from later file transfer.


## H5 review completion

The actual SDK contract requires `events/stream` and `next_page` pagination. Review
covered default toolset denial, immutable native versions/settings, original user-event
boundaries, current required custom calls, interruption echoes, budget waiting, cumulative
usage uncertainty, partial setup and owned cleanup. The official SDK 0.131 declarations
accept an async API-key getter that its runtime drops; supported request middleware now
refreshes the named connector, suppresses ambient bearer/workspace/cookie headers and
pins supported beta versions. Current scoped connector access is rechecked per request.
The final credential-rotation test setup initially registered an existing name; it was
corrected to remove/re-register explicitly, preserving Connector's existing contract.

## H6 implementation and review

- All five actual adapters run the same logical definition and selected blocking tool
  through two turns, with one digest and exactly one action per turn. Native OneRingAI
  runs its actual Agent loop. Codex uses real authenticated loopback MCP with a scripted
  CLI transport; Claude SDK uses real in-process MCP with scripted queries. Both managed
  drivers use actual SDK serialization and mock HTTP/SSE.
- Canonical nested JSON digests deduplicate equivalent arguments/requests; conflicting
  values reject. Native call IDs stay original in outcomes, while separate admitted runs
  cannot collide in the outbox. Recovery uses the original owner execution ID. Failed
  evidence acknowledgement/projection retains the source and stops delivery; a projection
  without original provenance cannot silently fall back to a raw body. Existing C7
  manager/owner identity and the C8 evidence profiles remain in use.
- Inspection reports selected schemas/transport names, configuration digest, placement,
  enforcement ownership and explicit unknown account access/partial usage/replay limits.
  Open and inspect share descriptor composition. Connector endpoint/account configuration,
  workspace, native profile and selected schema/fingerprint changes reject recovery.
  Unknown definition/binding/run fields reject; native workflow/ModelTask authority is
  not accepted as a runtime option or reconstructed from JSON.
- Explicit host-authorized upload/download has bounded bytes and MIME, no traversal,
  symlinks or overwrite of local destinations, no redirect/arbitrary URL credential
  forwarding, exact metadata/stream byte counts and partial-file cleanup. OpenAI uses
  inline hosted files and immutable session artifact endpoints. Unknown inline upload
  acceptance blocks new input and preserves owned cleanup; file-list metadata cannot
  establish exact content. Claude separately records upload intent/file/mount ownership,
  reconciles original lost responses without another upload and checks exact native scope
  and expiry. Borrowed environments are preserved. Generated file retention remains
  provider-owned; references do not imply that bytes were downloaded.
- OneRingAI native context checkpoints remain scoped and host-configured. A local SDK
  ownership marker is not a transcript proof: restoring prior native history requires
  `verifyNativeCheckpoint` to verify complete source state/dependencies; otherwise the
  default preserves the reference and rejects. Active interrupted local input remains
  unknown. This correction narrows the earlier H3 restore description, without changing
  legacy runtime behavior or claiming a live native filesystem verification.
- File control storage is acknowledged single-host POSIX storage. The tested host is
  macOS/Node 24. Windows is rejected by this file implementation; custom acknowledged
  adapters remain supported. Control data must stay outside writable model workspaces
  and transfer roots. No distributed ownership or tenant sandbox is added.
- AMOS gains opt-in trusted runtime-host bootstrap and one UI adapter for all harnesses.
  Native-only commands are gated, actual restored capabilities are displayed, and explicit
  stop, detach, resume and shutdown remain distinct. Native stop failure still releases
  the runtime. The built CLI was exercised with piped inspect/status/detach/resume/exit:
  same reference restored, native context command denied, zero model inputs.
- Managed restart uses an actual producer crash and a second process against a surviving
  loopback mock API for each vendor. Each recovers ACK with one input/one effect and no
  cancellation from process exit. The Claude mock initially failed to flush quiet SSE
  headers, deadlocking input admission; the mock now acknowledges headers before waiting
  for events. No native/provider action was repeated to work around it.

## Initial H6 validation — 2026-10-28

`npm run build` (33 export files and ESM/CJS root/runtime Connector identity),
`npm run typecheck`, `npm run lint`, `npm run test:unit -- --maxWorkers=4` (**421 files,
9,285 tests**), `npm run examples:check`, `npm run test:agentic:compat`, the public/design
contract fixture, offline Stage 00 baseline, and AMOS typecheck/build/runtime lint pass.
The full suite includes **124 runtime/AMOS cases** and the existing evidence conformance,
source external execution, cancellation, portable/parameter/composition regressions.
The historical design prototype was updated to reference the delivered H6 transfer
signatures; legacy driver/backend/session/status compatibility assertions remain intact.

All eight new default offline examples pass from source. The same-definition example
uses the existing canonical baseline JSON/usage helpers; it makes no performance or
quality claim. Source and artifact transfer bytes/IDs are asserted, not inferred from
ACK text. Added Markdown links/anchors are checked. Live fixtures remain explicitly
credential-gated and **unrun** under the user's pause. No `test:agentic:live`, integration
credentials, release/version/publication, consumer upgrade or unrelated desktop change
was used.

The canonical User Guide retains `#agent-runtime-preview` and adds setup, limitations,
future-driver extension, recovery, files and main/renderer recipes. README, generated API,
AGENTS, examples, AMOS, runtime/distributed architecture, Version 2 availability/adoption/
handoff, outcome/evidence guides and Unreleased notes are synchronized. Remaining work
outside this delivery: vendor/platform/account live verification; App Server interactions,
remote backends, A2A and native workflow extensions require separately selected scope.


Final H6 failure review added fail-fast native cancellation for any unresolved host
broker/control-delivery error. If a tool settled but its result acknowledgement failed,
the native harness cannot treat that error as permission to repeat the action. The
regression repairs storage and redelivers the certified payload with one execution;
raw observation/notification remain separate from acknowledged persistence. Explicit
Agent owners also receive the actual native terminal status, bounded output and error
in `completeExternalExecution`, including incomplete/unknown outcomes. Native usage is
not attributed to that owner's configured model. All four terminal statuses have actual
backend/lifecycle regression coverage. Validation at this review point passed
421 files / 9,282 tests, including 121 runtime/AMOS cases; the final admission
regressions bring the current total above to 9,285 / 124. No legacy behavior is changed.


Final admission concurrency correction reserves the run-admission slot synchronously
before native state inspection or control writes. Transfers and detach cannot enter
that interval; destroy waits for admission and prevents dispatch if it closed the
observer first. Three gated-inspection regressions verify zero upload/detach overlap and
zero native inputs during shutdown or explicit cancellation. AMOS stop/Ctrl-C also
invalidates queued text immediately and cancels admission before native dispatch;
exit preserves already-detached work. Built-CLI checks cover both queued text and
an admission already waiting on native state inspection. Upstream vendor SDK JSON/SSE parsing allocations
remain separate from normalized retention bounds, as documented; no new global parser
or distributed scheduling abstraction was added.


## H6 final package gate

The final executable artifact contains 461 package files. All eight new offline
examples pass both from source and from the extracted package, including both real
managed producer-process crashes/recovery. The extracted package imports all six
root/runtime/driver entries in ESM and CJS and verifies Connector identity by
registering at the root and inspecting through the runtime. Its dependency directory
is linked to this checkout's installed dependencies; this is package-content and
resolution validation, not a fresh network dependency install. The temporary identity
probe initially assumed an undocumented Connector re-export; its corrected semantic
probe uses the actual public surfaces and passes.

Built AMOS verification confirms the same session reference after detach/resume,
rejection of native context commands, preservation on exit after detach, cancellation
of queued text, and cancellation while native-state admission is pending. Both stop
checks observe zero native inputs. All 145 added Markdown links/anchors resolve.
The final evidence/documentation-only repack is checked byte-for-byte against the
tested artifact for all remaining package contents. No executable source is changed
after the final build, full 9,285-test run, compatibility, type, lint, API generation,
examples, baseline, package and AMOS checks.

H0–H6 delivery is complete on branch with offline validation. Native provider,
platform and account live verification remains pending under the user's pause.
Nothing was committed, pushed, published, upgraded in a consumer, or released.


## Review corrections — 2026-11-01

The user requested a review pass, then authorized “fix all”. The four reproduced
findings are corrected without changing public signatures, defaults, status/event
unions, saved checkpoints or the legacy `.agent(spec)` surface.

| Finding | Correction | Regression evidence |
| --- | --- | --- |
| R1, P1: admitted command differed from mutable dispatch | Dispatch the detached input/options snapshot captured at `run()` entry; retain its live abort signal separately. | Process/stored control cases mutate input, model, nested reasoning/schema/metadata while admission waits. Exact original request IDs still identify the original dispatched command; live cancellation blocks dispatch. |
| R2, P1: failed resume cancelled managed work | Prefer safe native observation detach during rollback; never call destructive cleanup on an observation-independent session. | Both actual managed SDKs, using synthetic wire transports, survive failed sequence persistence and recover the original ACK with one input/one effect and zero implicit cancels. |
| R3, P2: failed restore left a cached partial observer | Prepare the wrappers privately, then register only after persistence and active-run adoption succeed. | Sequence-write and adoption failures allow genuine second restoration; concurrent calls contend on the existing storage writer instead of borrowing a partial session. |
| R4, P2: record-read failure leaked writer ownership | Cover the initial read with the same lease cleanup boundary, including when native/tool teardown fails. | Memory and POSIX file stores accept a retry after a transient read failure. |

Eight original regression cases failed before the fixes; all nine cases now pass,
including an additional live-signal preservation control. The focused runtime/AMOS
suite passes 133 cases in 17 files. The complete suite passes 9,294 tests in 422
files. Build/export identity, source/new-test/public-contract types, lint, legacy
compatibility, generated API (1,825 items), Stage 00 offline baseline, AMOS typecheck
and built CLI checks all pass. All eight offline examples pass from source and from
the extracted 462-file package, including real process crash/recovery for both
managed adapters. All 146 added local Markdown targets/anchors resolve. Final
repacking changes only documentation/evidence; all other package bytes are compared
with the executable artifact that passed these checks. The extracted artifact uses
this checkout's installed dependency directory, not a fresh network install.
The canonical recovery guide, Version 2 adoption record and Unreleased notes describe
the corrected behavior. No live-provider verification, release or consumer upgrade is
included. Machine-readable evidence: [correction validation](../evaluations/AGENT_HARNESS_CORRECTIONS_2026_11_01.json).
